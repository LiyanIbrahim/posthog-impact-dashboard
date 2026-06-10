# Submission: PostHog Engineering Impact Dashboard

## Dashboard URL

_(to be filled after Vercel deploy)_

---

## Approach

### The core question I tried to answer
"Who helps PostHog ship meaningful product outcomes, and who makes the whole team faster?"

Those are two different kinds of impact. Someone who ships 50 features but never reviews anyone's
code is not the same as someone who ships 20 features but unblocks 25 colleagues every week.
The model captures both, weighted by how much each matters.

### What I measured (and why)

| Dimension | Weight | Why this, not raw counts |
|---|---|---|
| **Product Impact** | 40% | Feature PRs (via title/label) + linked-issue bonus (confirmed problem solved) + core-area coverage. Excludes chore:/revert: prefixes to avoid inflating with maintenance work. |
| **Org Leverage** | 30% | Substantive reviews (approvals + change-requests only — not LGTM comments) on other engineers' PRs, weighted by PR complexity. Bonus for reviewing many distinct colleagues (log-scaled). High weight because one strong reviewer can multiply the whole team. |
| **Reliability & Quality** | 20% | Bug fixes, real test additions (auto-generated snapshots excluded), performance and refactor work, schema migrations. A PR can score across multiple sub-categories. |
| **Ownership & Complexity** | 10% | Cross-stack PRs (frontend + backend in same PR), migration/schema work, infra. File breadth capped at 30 to prevent mega-PRs from dominating. |

### What I deliberately did NOT measure
- Lines of code, additions/deletions — easy to inflate, no quality signal
- Raw PR count — high-volume but low-quality work would score poorly under this model
- Commits — not available in the PR-level data and would add noise

### Normalisation
Raw scores use `sqrt()` before min-max normalisation. Without it, the highest-volume engineer
gets 100 in every dimension and everyone else compresses near the bottom — a false picture of
a team where many people are active and capable.

### Tradeoffs and limitations
1. **Partial data (28 of 90 days)** — The full GitHub collection hit the rate limit mid-run.
   Scores are directionally correct but will shift when the full window is collected. Engineers
   with steady output across the full period will benefit most from the update.
2. **Title/label classifiers are heuristic** — We infer "feature" vs "fix" vs "chore" from PR
   title prefixes and labels. These are generally reliable for a project that follows conventional
   commits (PostHog does), but edge cases exist.
3. **Review data is capped at 20 per PR** — The GitHub GraphQL budget limited each PR to 20
   review records. PRs with more than 20 reviewers (rare at PostHog) will have undercounted org
   leverage for those reviewers.
4. **Org leverage is underweighted for pure reviewers** — Someone who reviews heavily but
   merges few PRs (e.g. a staff engineer in review-heavy mode) will score lower overall because
   product impact is 40% of the total. This is a deliberate choice (the assignment asks about
   "impact," which I interpret as including shipping), but worth flagging.

---

## Time taken

_(fill from timer)_

---

## Coding agent sessions

_(export from Cursor and attach)_
