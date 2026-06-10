/**
 * Aggregates posthog-prs.json into impact.json for the dashboard.
 *
 * IMPACT MODEL (no raw counts as the top-line metric)
 * ─────────────────────────────────────────────────────
 * We compute five independent dimensions per engineer, then surface all five
 * so the audience can validate the reasoning:
 *
 * 1. DELIVERY LEVERAGE
 *    Merged work that demonstrably unblocked others or solved real problems.
 *    - Each merged PR counts once, boosted if it closes a GitHub issue
 *      (real problem solved, not speculative improvement), discounted for
 *      pure chore/docs/ci PRs that have no product impact.
 *    - Does NOT reward high line counts — we normalise by whether the PR has
 *      linked issues, not by how many lines it touched.
 *
 * 2. CODE CENTRALITY
 *    Working in high-traffic, high-dependency directories is higher leverage
 *    than touching isolated or peripheral code.
 *    - For each directory (top 2 path segments), we count how many distinct
 *      authors merged PRs into it ("hotness").
 *    - An engineer's centrality score = Σ over their PRs of hotness(dir) / max_hotness.
 *    - Rewards specialists who own *core* subsystems over those who only touch
 *      infrequently-visited corners.
 *
 * 3. REVIEW LEVERAGE
 *    Reviews that unblock peers are as valuable as original contributions.
 *    - Only APPROVED and CHANGES_REQUESTED reviews on *other people's* PRs count.
 *    - Weighted by the PR's changedFiles (larger PRs take more review effort).
 *    - COMMENTED-only reviews are excluded (often noise; low signal of real judgement).
 *
 * 4. COLLABORATION REACH
 *    Engineers who review for many distinct colleagues multiply team output.
 *    = count of distinct PR authors whose work this engineer reviewed.
 *
 * 5. CONSISTENCY
 *    Steady week-over-week presence signals reliability, not a one-off burst.
 *    = number of distinct weeks in the window where this engineer merged at least one PR.
 *
 * COMPOSITE
 *    Each dimension is min-max normalised to [0, 1], then summed with weights:
 *    delivery(0.35) + centrality(0.25) + review(0.20) + reach(0.10) + consistency(0.10)
 *    The weights are shown to users so they can judge the tradeoffs.
 *
 * Run: node --env-file=.env.local scripts/aggregate.ts
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Types from collect-prs ────────────────────────────────────────────────

interface Review {
  author: string | null;
  state: string;
  commentCount: number;
}

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
}

interface LinkedIssue {
  number: number;
  title: string;
  url: string;
}

interface PullRequest {
  number: number;
  title: string;
  url: string;
  author: string | null;
  mergedAt: string;
  labels: string[];
  reviews: Review[];
  reviewCount: number;
  reviewCommentCount: number;
  changedFiles: number;
  files: FileChange[];
  additions: number;
  deletions: number;
  linkedIssues: LinkedIssue[];
}

interface CollectionResult {
  repository: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  pullRequestCount: number;
  pullRequests: PullRequest[];
}

// ─── Output types ──────────────────────────────────────────────────────────

export interface DimensionScore {
  raw: number;    // unnormalised value
  norm: number;   // 0–1 normalised
  label: string;  // human-readable explanation of the raw value
}

export interface EngineerImpact {
  login: string;
  rank: number;
  compositeScore: number;  // 0–100 final weighted score
  dimensions: {
    delivery: DimensionScore;
    centrality: DimensionScore;
    reviewLeverage: DimensionScore;
    collaborationReach: DimensionScore;
    consistency: DimensionScore;
  };
  narrative: string;  // one-line plain-English summary of why this engineer ranks here
  topAreas: string[]; // top subsystems this engineer works in
  prCount: number;
  reviewGiven: number;
  notableContributions: { title: string; url: string; closedIssues: number }[];
}

export interface ImpactData {
  repository: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totalPRsAnalyzed: number;
  totalEngineers: number;
  modelWeights: { delivery: number; centrality: number; reviewLeverage: number; collaborationReach: number; consistency: number };
  engineers: EngineerImpact[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const INPUT = join(ROOT, "data", "posthog-prs.json");
const OUTPUT = join(ROOT, "data", "impact.json");

/** Top 2 path segments: "posthog/api/capture.py" → "posthog/api" */
function topDir(path: string): string {
  const parts = path.split("/");
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return `${d.getUTCFullYear()}-W${String(Math.ceil(
    ((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7,
  )).padStart(2, "0")}`;
}

const CHORE_LABELS = new Set(["ci", "chore", "dependencies", "documentation", "docs", "bot", "automated"]);

function isChore(pr: PullRequest): boolean {
  if (pr.labels.some((l) => CHORE_LABELS.has(l.toLowerCase()))) return true;
  const lower = pr.title.toLowerCase();
  return (
    lower.startsWith("chore") ||
    lower.startsWith("bump ") ||
    lower.startsWith("update dependencies") ||
    lower.includes("dependabot") ||
    lower.includes("renovate")
  );
}

function minMaxNorm(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const collection: CollectionResult = JSON.parse(await readFile(INPUT, "utf8"));
  const prs = collection.pullRequests;

  // ── Exclude bots ──────────────────────────────────────────────────────────
  const BOT_SUFFIXES = ["[bot]", "-bot", "_bot"];
  const humanPRs = prs.filter(
    (pr) =>
      pr.author &&
      !BOT_SUFFIXES.some((s) => pr.author!.toLowerCase().includes(s)),
  );

  // ── Directory hotness: distinct author count per top-level dir ────────────
  const dirAuthors = new Map<string, Set<string>>();
  for (const pr of humanPRs) {
    if (!pr.author) continue;
    for (const f of pr.files) {
      const dir = topDir(f.path);
      if (!dirAuthors.has(dir)) dirAuthors.set(dir, new Set());
      dirAuthors.get(dir)!.add(pr.author);
    }
  }
  const maxDirHotness = Math.max(...[...dirAuthors.values()].map((s) => s.size), 1);

  // ── Per-engineer aggregation ──────────────────────────────────────────────
  const engineers = new Map<
    string,
    {
      mergedPRs: PullRequest[];
      reviewedPRs: { pr: PullRequest; states: string[] }[];
      reviewedAuthors: Set<string>;
    }
  >();

  function getEng(login: string) {
    if (!engineers.has(login)) {
      engineers.set(login, { mergedPRs: [], reviewedPRs: [], reviewedAuthors: new Set() });
    }
    return engineers.get(login)!;
  }

  // Own PRs
  for (const pr of humanPRs) {
    if (pr.author) getEng(pr.author).mergedPRs.push(pr);
  }

  // Reviews given (on other people's PRs only)
  for (const pr of humanPRs) {
    const prAuthor = pr.author;
    // Group reviews by reviewer
    const byReviewer = new Map<string, string[]>();
    for (const rv of pr.reviews) {
      if (!rv.author || rv.author === prAuthor) continue;
      if (!byReviewer.has(rv.author)) byReviewer.set(rv.author, []);
      byReviewer.get(rv.author)!.push(rv.state);
    }
    for (const [reviewer, states] of byReviewer) {
      const eng = getEng(reviewer);
      // Only count substantive reviews
      const substantive = states.filter(
        (s) => s === "APPROVED" || s === "CHANGES_REQUESTED",
      );
      if (substantive.length > 0) {
        eng.reviewedPRs.push({ pr, states: substantive });
        if (prAuthor) eng.reviewedAuthors.add(prAuthor);
      }
    }
  }

  // ── Compute raw dimension scores ──────────────────────────────────────────
  const logins = [...engineers.keys()];

  const rawDelivery = logins.map((login) => {
    const { mergedPRs } = engineers.get(login)!;
    // Each PR has base weight 1; +0.5 if it closes an issue; ×0.3 if it's a chore
    return mergedPRs.reduce((sum, pr) => {
      const base = isChore(pr) ? 0.3 : 1.0;
      const issueBump = pr.linkedIssues.length > 0 ? 0.5 : 0;
      return sum + base + issueBump;
    }, 0);
  });

  const rawCentrality = logins.map((login) => {
    const { mergedPRs } = engineers.get(login)!;
    let total = 0;
    for (const pr of mergedPRs) {
      if (isChore(pr)) continue;
      for (const f of pr.files) {
        const hotness = dirAuthors.get(topDir(f.path))?.size ?? 1;
        total += hotness / maxDirHotness;
      }
    }
    return total;
  });

  const rawReview = logins.map((login) => {
    const { reviewedPRs } = engineers.get(login)!;
    // Weight each reviewed PR by its changedFiles (proxy for review effort)
    return reviewedPRs.reduce(
      (sum, { pr }) => sum + Math.min(pr.changedFiles, 50), // cap at 50 to reduce outlier skew
      0,
    );
  });

  const rawReach = logins.map(
    (login) => engineers.get(login)!.reviewedAuthors.size,
  );

  const rawConsistency = logins.map((login) => {
    const weeks = new Set(
      engineers.get(login)!.mergedPRs.map((pr) => isoWeek(new Date(pr.mergedAt))),
    );
    return weeks.size;
  });

  // ── Normalise ─────────────────────────────────────────────────────────────
  const normDelivery = minMaxNorm(rawDelivery);
  const normCentrality = minMaxNorm(rawCentrality);
  const normReview = minMaxNorm(rawReview);
  const normReach = minMaxNorm(rawReach);
  const normConsistency = minMaxNorm(rawConsistency);

  const WEIGHTS = { delivery: 0.35, centrality: 0.25, reviewLeverage: 0.20, collaborationReach: 0.10, consistency: 0.10 };

  // ── Build final objects ───────────────────────────────────────────────────
  const results: EngineerImpact[] = logins.map((login, i) => {
    const { mergedPRs, reviewedPRs, reviewedAuthors } = engineers.get(login)!;
    const composite =
      normDelivery[i] * WEIGHTS.delivery +
      normCentrality[i] * WEIGHTS.centrality +
      normReview[i] * WEIGHTS.reviewLeverage +
      normReach[i] * WEIGHTS.collaborationReach +
      normConsistency[i] * WEIGHTS.consistency;

    // Top areas (directories with most PR contributions)
    const dirCounts = new Map<string, number>();
    for (const pr of mergedPRs) {
      for (const f of pr.files) {
        const d = topDir(f.path);
        dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
      }
    }
    const topAreas = [...dirCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d]) => d);

    // Notable contributions: PRs with most linked issues or largest scope
    const notableContributions = mergedPRs
      .filter((pr) => !isChore(pr))
      .sort((a, b) => b.linkedIssues.length - a.linkedIssues.length || b.changedFiles - a.changedFiles)
      .slice(0, 3)
      .map((pr) => ({ title: pr.title, url: pr.url, closedIssues: pr.linkedIssues.length }));

    // Narrative
    const issuePRs = mergedPRs.filter((pr) => pr.linkedIssues.length > 0);
    const reviewedCount = reviewedPRs.length;
    const prCount = mergedPRs.filter((p) => !isChore(p)).length;
    const areaStr = topAreas.slice(0, 2).join(", ") || "various areas";

    let narrative = `Merged ${prCount} impactful PR${prCount !== 1 ? "s" : ""}`;
    if (issuePRs.length > 0)
      narrative += `, ${issuePRs.length} closing tracked issues`;
    if (topAreas.length > 0)
      narrative += `, primarily in ${areaStr}`;
    if (reviewedCount > 0)
      narrative += `; reviewed ${reviewedCount} PR${reviewedCount !== 1 ? "s" : ""} for ${reviewedAuthors.size} colleague${reviewedAuthors.size !== 1 ? "s" : ""}`;
    narrative += ".";

    return {
      login,
      rank: 0,
      compositeScore: Math.round(composite * 100),
      dimensions: {
        delivery: {
          raw: rawDelivery[i],
          norm: normDelivery[i],
          label: `${mergedPRs.filter((p) => !isChore(p)).length} impactful PRs merged (${issuePRs.length} closed tracked issues)`,
        },
        centrality: {
          raw: rawCentrality[i],
          norm: normCentrality[i],
          label: `Works in high-traffic code areas (${topAreas[0] ?? "—"})`,
        },
        reviewLeverage: {
          raw: rawReview[i],
          norm: normReview[i],
          label: `Substantive reviews on ${reviewedPRs.length} PRs (weighted by PR size)`,
        },
        collaborationReach: {
          raw: rawReach[i],
          norm: normReach[i],
          label: `Reviewed work from ${reviewedAuthors.size} distinct colleagues`,
        },
        consistency: {
          raw: rawConsistency[i],
          norm: normConsistency[i],
          label: `Active in ${[...new Set(mergedPRs.map((pr) => isoWeek(new Date(pr.mergedAt))))].length} of the weeks in this window`,
        },
      },
      narrative,
      topAreas,
      prCount: mergedPRs.length,
      reviewGiven: reviewedPRs.length,
      notableContributions,
    };
  });

  // ── Sort, rank, take top 10 for output (dashboard shows top 5) ───────────
  results.sort((a, b) => b.compositeScore - a.compositeScore);
  results.forEach((e, i) => (e.rank = i + 1));

  const top = results.slice(0, 10);

  const output: ImpactData = {
    repository: collection.repository,
    generatedAt: collection.generatedAt,
    windowStart: collection.windowStart,
    windowEnd: collection.windowEnd,
    totalPRsAnalyzed: humanPRs.length,
    totalEngineers: results.length,
    modelWeights: WEIGHTS,
    engineers: top,
  };

  await writeFile(OUTPUT, JSON.stringify(output, null, 2));

  console.log(`\nTop 5 engineers (out of ${results.length}):`);
  for (const e of top.slice(0, 5)) {
    console.log(`  #${e.rank} ${e.login.padEnd(24)} score=${e.compositeScore}  ${e.narrative}`);
  }
  console.log(`\nFull top-10 written to ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
