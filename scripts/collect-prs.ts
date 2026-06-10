/**
 * collect-prs.ts — Two-phase collection strategy
 *
 * PHASE 1 — REST Search (~3 min, ~90 requests):
 *   Fetches lightweight metadata for ALL merged PRs in the 90-day window
 *   using 7-day windows (each safely under the 1,000-result Search API cap).
 *   Fields per PR: title, URL, author, mergedAt, labels, body.
 *   Body is parsed locally for "closes/fixes/resolves #N" linked-issue signals.
 *
 * PHASE 2a — GraphQL file enrichment (~1,800 GraphQL pts):
 *   For each active engineer (≥3 merged PRs), fetches file paths and change
 *   counts for their 10 most-recent PRs. Enables product-area classification
 *   and cross-stack detection for a representative sample.
 *
 * PHASE 2b — GraphQL reviewed-by (~2,000 GraphQL pts):
 *   For each active engineer, issues a single `reviewed-by:LOGIN` search
 *   query to find all PRs they reviewed. Captures org-leverage signals for
 *   every active contributor without scanning every PR's review list.
 *
 * Total GraphQL budget: ~3,800 / 5,000 points — fits in a single hour window.
 * REST and GraphQL rate limits are independent; both phases run in ~15 min.
 *
 * Tradeoff:
 *   ✓  100% of PRs captured for title / label / linked-issue scoring
 *   ✓  File paths for top contributors' PRs (~10% of all PRs enriched)
 *   ✓  Review signals for all active engineers
 *   ~  Ownership & Complexity scores rely on file data only for enriched PRs;
 *      non-enriched PRs fall back to title-keyword signals.
 *
 * Run:  node --env-file=.env.local scripts/collect-prs.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface LinkedIssue {
  number: number;
  url: string;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  author: string | null;
  mergedAt: string;
  labels: string[];
  body: string;
  commentCount: number;
  changedFiles: number;   // 0 when not enriched
  additions: number;      // 0 when not enriched
  deletions: number;      // 0 when not enriched
  files: FileChange[] | null; // null = not enriched in Phase 2a
  linkedIssues: LinkedIssue[];
  enriched: boolean;
}

export interface ReviewedPRSummary {
  prNumber: number;
  prAuthor: string;
  changedFiles: number;
}

export interface CollectionResult {
  repository: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  pullRequestCount: number;
  pullRequests: PullRequest[];
  /** Per-engineer review signals from Phase 2b reviewed-by queries */
  reviewedByEngineer: Record<string, ReviewedPRSummary[]>;
  enrichedPRCount: number;
  coverageNote: string;
}

// ── Config ─────────────────────────────────────────────────────────────────

const REPO        = "PostHog/posthog";
const DAYS        = Number(process.env.DAYS ?? "90");
const WINDOW_DAYS = 7;
const FORCE_REFRESH = process.env.FORCE_REFRESH === "1";

const REST_BASE   = "https://api.github.com";
const GRAPHQL_URL = `${REST_BASE}/graphql`;
const ROOT        = process.cwd();
const CACHE_DIR   = join(ROOT, ".cache", "github-v2");
const OUTPUT_PATH = join(ROOT, "data", "posthog-prs.json");
const TOKEN       = process.env.GITHUB_TOKEN;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── REST helper ────────────────────────────────────────────────────────────

async function restGet<T>(url: string, attempt = 1): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "posthog-impact-dashboard",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (res.status === 403 || res.status === 429) {
    if (attempt > 6) throw new Error(`REST rate limited on ${url}`);
    const retryAfter = res.headers.get("retry-after");
    const resetAt    = res.headers.get("x-ratelimit-reset");
    let waitMs = attempt * 12_000;
    if (retryAfter) waitMs = Number(retryAfter) * 1_000;
    else if (resetAt) waitMs = Math.max(Number(resetAt) * 1_000 - Date.now() + 5_000, 5_000);
    console.warn(`  REST ${res.status} — waiting ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
    return restGet<T>(url, attempt + 1);
  }

  if (!res.ok) throw new Error(`REST error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── GraphQL helper ─────────────────────────────────────────────────────────

interface RateLimit { remaining: number; resetAt: string; }

async function graphql<T extends { rateLimit?: RateLimit }>(
  query: string,
  variables: Record<string, unknown>,
  attempt = 1,
): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "posthog-impact-dashboard",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 403 || res.status === 429) {
    if (attempt > 8) throw new Error("GraphQL HTTP rate limit exceeded");
    const wait = attempt * 12_000;
    console.warn(`  GraphQL HTTP ${res.status} — waiting ${wait / 1000}s`);
    await sleep(wait);
    return graphql<T>(query, variables, attempt + 1);
  }

  if (!res.ok) throw new Error(`GraphQL ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as {
    data?: T;
    errors?: { type?: string; message?: string }[];
  };

  if (json.errors?.some((e) => e.type === "RATE_LIMITED")) {
    if (attempt > 8) throw new Error("GraphQL RATE_LIMITED persists");
    try {
      const rl = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "posthog-impact-dashboard" },
        body: JSON.stringify({ query: "{ rateLimit { resetAt } }" }),
      });
      const rlj = (await rl.json()) as { data?: { rateLimit?: { resetAt?: string } } };
      const resetAt = rlj.data?.rateLimit?.resetAt;
      const waitMs  = resetAt
        ? Math.max(new Date(resetAt).getTime() - Date.now() + 15_000, 0)
        : 65_000;
      console.warn(`  GraphQL RATE_LIMITED — waiting ${Math.ceil(waitMs / 60_000)} min`);
      await sleep(waitMs);
    } catch { await sleep(65_000); }
    return graphql<T>(query, variables, attempt + 1);
  }

  if (json.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  if (!json.data) throw new Error("GraphQL response missing data");
  return json.data;
}

async function proactiveRateLimitWait(rl: RateLimit, threshold = 150): Promise<void> {
  if (rl.remaining < threshold) {
    const waitMs = Math.max(new Date(rl.resetAt).getTime() - Date.now() + 15_000, 0);
    console.warn(`  ⚠  Only ${rl.remaining} GraphQL points left — pausing ${Math.ceil(waitMs / 60_000)} min`);
    await sleep(waitMs);
  } else {
    await sleep(100);
  }
}

// ── Parse linked issues from PR body ──────────────────────────────────────

function parseLinkedIssues(body: string | null): LinkedIssue[] {
  if (!body) return [];
  const RE = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  const numbers = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = RE.exec(body)) !== null) numbers.add(Number(m[1]));
  return [...numbers].map((n) => ({
    number: n,
    url: `https://github.com/${REPO}/issues/${n}`,
  }));
}

function isBot(login: string): boolean {
  return /\[bot\]$|-bot$|_bot$|dependabot|renovate/i.test(login);
}

// ── PHASE 1: REST Search ───────────────────────────────────────────────────

interface RestSearchItem {
  number: number;
  title: string;
  html_url: string;
  user: { login: string; type: string } | null;
  labels: { name: string }[];
  body: string | null;
  comments: number;
  pull_request?: { merged_at: string | null };
}

interface RestSearchResponse {
  total_count: number;
  items: RestSearchItem[];
}

async function fetchWindowRest(start: Date, end: Date): Promise<PullRequest[]> {
  const s = start.toISOString().slice(0, 10);
  const e = end.toISOString().slice(0, 10);
  const cachePath = join(CACHE_DIR, `search-${s}_${e}.json`);

  if (!FORCE_REFRESH && existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as PullRequest[];
    console.log(`  cache hit  ${s} → ${e} (${cached.length} PRs)`);
    return cached;
  }

  const q   = encodeURIComponent(`repo:${REPO} is:pr is:merged merged:${s}..${e}`);
  const prs: PullRequest[] = [];
  let page = 1;

  while (true) {
    const url  = `${REST_BASE}/search/issues?q=${q}&sort=created&order=desc&per_page=100&page=${page}`;
    const data = await restGet<RestSearchResponse>(url);

    for (const item of data.items) {
      const mergedAt = item.pull_request?.merged_at;
      if (!mergedAt) continue;
      const login = item.user?.login ?? null;
      if (login && isBot(login)) continue;
      prs.push({
        number: item.number,
        title:  item.title,
        url:    item.html_url,
        author: login,
        mergedAt,
        labels: item.labels.map((l) => l.name),
        body:   item.body ?? "",
        commentCount: item.comments,
        changedFiles: 0,
        additions:    0,
        deletions:    0,
        files:        null,
        linkedIssues: parseLinkedIssues(item.body),
        enriched:     false,
      });
    }

    const fetched = (page - 1) * 100 + data.items.length;
    if (fetched >= data.total_count || data.items.length < 100) break;
    if (fetched >= 1000) {
      console.warn(`  window ${s}→${e} hit 1000-result cap — splitting may be needed`);
      break;
    }
    page++;
    await sleep(2_200); // Search API: stay under 30 req/min
  }

  await writeFile(cachePath, JSON.stringify(prs, null, 2));
  console.log(`  fetched    ${s} → ${e} (${prs.length} PRs)`);
  return prs;
}

// ── PHASE 2a: GraphQL file enrichment ─────────────────────────────────────

const FILES_QUERY = `
  query FilesForEngineer($q: String!, $after: String) {
    search(query: $q, type: ISSUE, first: 10, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          changedFiles
          additions
          deletions
          files(first: 5) { nodes { path additions deletions } }
        }
      }
    }
    rateLimit { remaining cost resetAt }
  }
`;

interface FilesResponse {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      number?: number;
      changedFiles?: number;
      additions?: number;
      deletions?: number;
      files?: { nodes: { path: string; additions: number; deletions: number }[] };
    }[];
  };
  rateLimit: RateLimit;
}

interface PRFileData {
  prNumber: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  files: FileChange[];
}

async function fetchFilesForEngineer(
  login: string,
  startISO: string,
  endISO: string,
): Promise<PRFileData[]> {
  const cachePath = join(CACHE_DIR, `files-${login}.json`);
  if (!FORCE_REFRESH && existsSync(cachePath)) {
    return JSON.parse(await readFile(cachePath, "utf8")) as PRFileData[];
  }

  // Intentionally fetch only the first 10 PRs (no pagination).
  // We need a representative sample for file-path signals, not exhaustive coverage.
  const q = `author:${login} repo:${REPO} is:pr is:merged merged:${startISO}..${endISO} sort:updated-desc`;
  const results: PRFileData[] = [];

  const data = await graphql<FilesResponse>(FILES_QUERY, { q, after: null });
  for (const node of data.search.nodes) {
    if (!node.number) continue;
    results.push({
      prNumber:     node.number,
      changedFiles: node.changedFiles ?? 0,
      additions:    node.additions ?? 0,
      deletions:    node.deletions ?? 0,
      files: (node.files?.nodes ?? []).map((f) => ({
        path:      f.path,
        additions: f.additions,
        deletions: f.deletions,
      })),
    });
  }
  await proactiveRateLimitWait(data.rateLimit);

  await writeFile(cachePath, JSON.stringify(results, null, 2));
  return results;
}

// ── PHASE 2b: GraphQL reviewed-by ─────────────────────────────────────────

const REVIEWED_BY_QUERY = `
  query ReviewedBy($q: String!, $after: String) {
    search(query: $q, type: ISSUE, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          changedFiles
          author { login }
        }
      }
    }
    rateLimit { remaining cost resetAt }
  }
`;

interface ReviewedByResponse {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      number?: number;
      changedFiles?: number;
      author?: { login: string } | null;
    }[];
  };
  rateLimit: RateLimit;
}

async function fetchReviewedBy(
  login: string,
  startISO: string,
  endISO: string,
): Promise<ReviewedPRSummary[]> {
  const cachePath = join(CACHE_DIR, `reviews-${login}.json`);
  if (!FORCE_REFRESH && existsSync(cachePath)) {
    return JSON.parse(await readFile(cachePath, "utf8")) as ReviewedPRSummary[];
  }

  // -author:login filters out self-reviews (own PRs that were "reviewed by" themselves)
  const q = `reviewed-by:${login} repo:${REPO} is:pr is:merged merged:${startISO}..${endISO} -author:${login}`;
  const results: ReviewedPRSummary[] = [];
  let after: string | null = null;

  do {
    const data: ReviewedByResponse = await graphql<ReviewedByResponse>(REVIEWED_BY_QUERY, { q, after });
    for (const node of data.search.nodes) {
      if (!node.number || !node.author) continue;
      results.push({
        prNumber:    node.number,
        prAuthor:    node.author.login,
        changedFiles: node.changedFiles ?? 0,
      });
    }
    after = data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null;
    await proactiveRateLimitWait(data.rateLimit);
  } while (after);

  await writeFile(cachePath, JSON.stringify(results, null, 2));
  return results;
}

// ── Window builder ─────────────────────────────────────────────────────────

function buildWindows(from: Date, to: Date): { start: Date; end: Date }[] {
  const windows: { start: Date; end: Date }[] = [];
  let cursor = new Date(from);
  while (cursor < to) {
    const end = new Date(cursor);
    end.setUTCDate(end.getUTCDate() + WINDOW_DAYS);
    windows.push({ start: new Date(cursor), end: end < to ? end : new Date(to) });
    cursor = end;
  }
  return windows;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!TOKEN) throw new Error("GITHUB_TOKEN not set. Run: node --env-file=.env.local ...");

  const now   = new Date();
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - DAYS);
  since.setUTCHours(0, 0, 0, 0);

  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(join(ROOT, "data"), { recursive: true });

  const startISO = since.toISOString();
  const endISO   = now.toISOString();

  // ── Phase 1: REST Search ─────────────────────────────────────────────────
  console.log(`\n═══ Phase 1: REST Search — ${DAYS}-day window ═══`);
  console.log(`${REPO}  ${startISO.slice(0, 10)} → ${endISO.slice(0, 10)}\n`);

  const windows   = buildWindows(since, now);
  const byNumber  = new Map<number, PullRequest>();

  for (const { start, end } of windows) {
    const prs = await fetchWindowRest(start, end);
    for (const pr of prs) byNumber.set(pr.number, pr);
  }

  const allPRs = [...byNumber.values()].sort((a, b) =>
    a.mergedAt < b.mergedAt ? 1 : -1,
  );
  console.log(`\n✓ Phase 1 complete: ${allPRs.length} PRs across ${windows.length} windows\n`);

  // Identify active engineers
  const prCountByLogin = new Map<string, number>();
  for (const pr of allPRs) {
    if (!pr.author || isBot(pr.author)) continue;
    prCountByLogin.set(pr.author, (prCountByLogin.get(pr.author) ?? 0) + 1);
  }
  const activeLogins = [...prCountByLogin.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([login]) => login);

  console.log(`Active engineers (≥3 PRs): ${activeLogins.length}`);

  // ── Phase 2a: File enrichment ────────────────────────────────────────────
  console.log(`\n═══ Phase 2a: GraphQL file enrichment (${activeLogins.length} engineers) ═══\n`);

  const prFileMap = new Map<number, PRFileData>();
  for (const login of activeLogins) {
    const fileData = await fetchFilesForEngineer(login, startISO, endISO);
    for (const d of fileData) prFileMap.set(d.prNumber, d);
    console.log(`  ${login.padEnd(28)} ${fileData.length} PRs enriched`);
    await sleep(300);
  }

  let enrichedCount = 0;
  for (const pr of allPRs) {
    const d = prFileMap.get(pr.number);
    if (d) {
      pr.files        = d.files;
      pr.changedFiles = d.changedFiles;
      pr.additions    = d.additions;
      pr.deletions    = d.deletions;
      pr.enriched     = true;
      enrichedCount++;
    }
  }
  console.log(`\n✓ Phase 2a complete: ${enrichedCount} PRs enriched with file paths\n`);

  // ── Phase 2b: Reviewed-by ────────────────────────────────────────────────
  console.log(`\n═══ Phase 2b: GraphQL reviewed-by (${activeLogins.length} engineers) ═══\n`);

  const reviewedByEngineer: Record<string, ReviewedPRSummary[]> = {};
  for (const login of activeLogins) {
    const reviews = await fetchReviewedBy(login, startISO, endISO);
    reviewedByEngineer[login] = reviews;
    console.log(`  ${login.padEnd(28)} reviewed ${reviews.length} PRs`);
    await sleep(300);
  }
  console.log(`\n✓ Phase 2b complete\n`);

  // ── Write output ──────────────────────────────────────────────────────────
  const coverageNote =
    `Two-phase collection. ` +
    `Full metadata (title, labels, linked issues) for all ${allPRs.length} merged PRs. ` +
    `File paths enriched for ${enrichedCount} PRs from ${activeLogins.length} active engineers. ` +
    `Review signals captured for all ${activeLogins.length} active engineers via reviewed-by queries.`;

  const result: CollectionResult = {
    repository:      REPO,
    generatedAt:     now.toISOString(),
    windowStart:     since.toISOString(),
    windowEnd:       now.toISOString(),
    pullRequestCount: allPRs.length,
    pullRequests:    allPRs,
    reviewedByEngineer,
    enrichedPRCount: enrichedCount,
    coverageNote,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`Done. ${allPRs.length} PRs (${enrichedCount} enriched) written to ${OUTPUT_PATH}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
