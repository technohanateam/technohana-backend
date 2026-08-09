# AI Content Factory — Operations Guide

Operational runbook for the AI Content Factory (all 5 milestones). Pairs with
`AI_CONTENT_FACTORY_IMPLEMENTATION.md` (architecture/as-built) and
`AI_CONTENT_FACTORY_PROMPTS.md` (prompt catalog).

## Pause / resume automation

**Where:** Admin → Content Factory → Dashboard (`/admin/content-factory/dashboard`) —
the "Automation Status" card has a single Pause/Enable button.

**API:** `POST /admin/content-factory/settings/toggle-automation` (`requireAdmin`)
```json
{ "automationStatus": "PAUSED" | "ENABLED", "pausedReason": "optional string" }
```

**What pausing actually stops:** only `dailyPlanningJob.processor.js` (the cron-driven
daily planning run, and its manually-triggered `POST /plan/run-now` twin) checks
`automationStatus` — it short-circuits at step (1), before any AI spend, and logs a
`ContentRun` with `status:"COMPLETE"` and an `errors: ["skipped — automation paused"]` note
so the skip is visible in Recent Content Runs. Everything else keeps working regardless of
`automationStatus`:
- `POST /plan/dry-run` (manual planning, zero Blogs writes)
- `POST /opportunities/:id/generate`, `/jobs/:id/retry` (single-item generation)
- The entire Human Review flow (`/review/**`, including bulk actions)
- The Calendar/Backlog controllers
- `runFreshnessScan()` — the weekly freshness job is a read/classify-only job with no AI
  calls and no Blogs writes, so it is intentionally NOT gated by `automationStatus`.

This is by design (per the plan): automation controls whether the factory acts on its own;
manual, human-initiated single-item actions always work.

## Reading the cost dashboard

**Where:** Dashboard's "Today's AI Spend" card — progress bar of
`todaySpendUsd / dailyAiBudgetUsd`, plus total call count.

**API:** `GET /admin/content-factory/usage?range=today` (`requireAdmin` — financial data).
Backed by `aiUsageLog.model.js` rows, one per `trackedCallClaude()`/`recordAiUsage()` call
(every content-factory Claude call routes through one of these — see
`aiUsageTracker.service.js`). `callType` on each row tells you which pipeline step spent the
money: `opportunityCandidates`, `brief`, `articleWriter` (recorded manually inside its own
web-search loop), `seo`, `links`, `imagePrompt`, `factCheck`, `aiStyleEval`, `qualityEval`,
`revision`, `trendResearch` (Milestone 5).

**Cost estimates are approximate**, not exact billing — `aiUsageTracker.service.js`'s
`COST_PER_1K_TOKENS` table is a rough public-pricing estimate for budget-tracking UI
purposes, not a reconciled invoice.

## Responding to a budget-exceeded auto-pause

When `todaySpendUsd` would exceed `dailyAiBudgetUsd`, `budgetGuard.service.js`'s
`enforceBudgetOrPause()` automatically:
1. Sets `automationStatus: "PAUSED"`, `pausedReason: "DAILY_AI_BUDGET_EXCEEDED"`,
   `pausedAt`/`budgetExceededAt` timestamps.
2. Emails `process.env.MAIL_TO` (via the existing `sendEmail()`/Resend integration) with the
   reason and current spend/budget numbers.
3. The Dashboard shows a red banner ("Automation paused — daily AI budget exceeded") with a
   one-click "Re-enable Automation" button.

**To respond:**
1. Open the Dashboard, review "Today's AI Spend" and the `GET /usage` breakdown by
   `callType` to see what consumed the budget.
2. Either (a) wait for the daily rollover — `todaySpendUsd` resets to 0 automatically the
   next time any AI call happens on a new calendar day (`aiUsageTracker.service.js` compares
   `todaySpendDate` to today before incrementing) — or (b) raise `dailyAiBudgetUsd` via
   `PATCH /admin/content-factory/settings` if the current cap is genuinely too low for your
   content volume.
3. Click "Re-enable Automation" (or `POST /settings/toggle-automation` with
   `{"automationStatus":"ENABLED"}`) once you've reviewed spend — this does NOT clear
   `pausedReason`/`budgetExceededAt` history automatically; those are informational fields
   only, re-checked fresh on the next budget evaluation.

Mid-run breaches are also caught: `dailyPlanningJob.processor.js` re-checks the budget
between major phases (after priority refresh, after trend/gap analysis, before
auto-generation, and — Milestone 5 — before every individual trend-research cluster call)
so a run stops spending as soon as it crosses the line rather than only checking once at the
top.

## Re-mapping topic clusters safely

Topic-cluster mapping is **never auto-applied** — it always requires an explicit admin
confirmation step, by design (plan decision, unchanged across all 5 milestones):

1. Admin → Content Factory → Topic Clusters (`/admin/content-factory/topic-clusters`).
2. Click "Propose Mapping" → `POST /admin/content-factory/clusters/propose-mapping`
   (`requireAdmin`, rate-limited via `contentFactoryAiLimiter`) — makes ONE Claude call over
   the real distinct `Course.category` values (`topicClusterProposal.prompt.js`) and returns
   a proposed `{clusters: [...]}` list. **Nothing is written to the database by this step.**
3. Review the proposal in the UI (edit names/descriptions/category assignments/priority
   inline if needed).
4. Click "Apply" → `POST /admin/content-factory/clusters/apply-mapping` (`requireAdmin`) —
   only this step writes `TopicCluster` documents, and only the exact set the admin
   confirmed (possibly hand-edited from the AI's proposal).
5. Individual clusters can also be created/edited/deleted directly at any time via
   `POST/PATCH/DELETE /admin/content-factory/clusters` without going through the AI proposal
   flow at all — remapping is always an explicit, reviewable, admin-driven action.

Re-mapping does not retroactively touch existing `ContentOpportunity`/`Blogs` documents —
only future planning runs use the updated cluster set.

## Bull repeatables — cron schedule

| Queue | Cron | Meaning | Processor |
|---|---|---|---|
| `content-factory-planning` | `0 5 * * *` | Daily, 5:00 AM UTC | `runDailyPlanningJob()` (`dailyPlanningJob.processor.js`) |
| `content-factory-freshness` | `0 6 * * 0` | Weekly, Sunday 6:00 AM UTC | `runFreshnessScan()` (`contentFreshness.service.js`, Milestone 5) |

Both are registered by `scheduleContentFactoryRepeatables()`
(`contentFactoryQueue.js`), called once at boot from `src/index.js`. Bull dedupes
repeatables by `cron` + job data, so this is safe to call on every server restart/deploy —
it will not create duplicate repeatable schedules. The freshness job is scheduled an hour
after daily planning so `CourseContentSettings.freshnessStatus` is fresh going into that
same morning's planning run's due-ness calculations (though Sunday's freshness scan mainly
feeds the *following* week's daily runs, since it only runs once a week).

Manual triggers (bypass the cron, run immediately): "Run Dry-Run Plan Now" and "Run
Planning Job Now" buttons on the Dashboard (`POST /plan/dry-run` and `POST /plan/run-now`
respectively). There is currently no manual UI trigger for the freshness scan — enqueue one
ad-hoc via `contentFactoryFreshnessQueue.add({})` from a Node REPL/script if needed before
the next Sunday.

## If the daily planning job silently stops running

This is a Redis/Bull health question, not a content-factory-specific one — see
`REDIS_SETUP.md` for full connection setup. Checklist:

1. **Confirm Redis is reachable.** Railway: check the Redis plugin's status in the Railway
   dashboard, and confirm `REDIS_URL` (preferred) or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`
   are set correctly on the backend service. `src/config/redis.js` logs which mode it's using
   (`[redis] using REDIS_URL (...)` or `[redis] using REDIS_HOST/PORT (...)`) and retries
   connection failures with capped exponential backoff, logging
   `[redis] connection retry #N` — check server logs for these lines first.
2. **Check queue error/stalled logs.** `contentFactoryQueue.js` logs on every queue event:
   `[content-factory-planning] job N completed/failed/stalled` and the same for
   `[content-factory-freshness]` (Milestone 5). A repeated `stalled` with no matching
   `completed` suggests a worker crash mid-job — check for uncaught exceptions in the
   process logs around that time.
3. **Confirm the repeatable is actually registered.** `scheduleContentFactoryRepeatables()`
   runs at boot — if the server never successfully started (crash-looping, failed DB
   connection, etc.), the repeatable was never (re-)registered. A Bull repeatable does
   persist in Redis across restarts once registered, but a fresh Redis instance (e.g. a
   Railway Redis plugin recreated from scratch) has no memory of it until the app boots
   again successfully.
4. **Check `automationStatus`.** The most common "why didn't it run" cause isn't a Redis
   problem at all — it's `automationStatus: "PAUSED"` (either manually or via
   budget-auto-pause). The job DOES still run on schedule in this case, but no-ops
   immediately and logs a skipped `ContentRun` — check Recent Content Runs on the Dashboard
   before assuming a queue outage.
5. **Check `ContentRun` history directly** (`GET /admin/content-factory/runs`) — if there is
   no `ContentRun` at all for the expected day (not even a "skipped" one), the job never
   fired; if there is one with `status:"FAILED"`, read its `errors` array for the thrown
   error message.

## Rollback guidance

No destructive migration is ever needed to disable the AI Content Factory — every schema
change across all 5 milestones is additive (new collections, or new optional fields on
existing ones), and nothing the factory does mutates existing `Blogs` content without an
explicit human approve action.

**To fully disable automation** (keep the admin UI, just stop anything running on its own):
```
POST /admin/content-factory/settings/toggle-automation
{ "automationStatus": "PAUSED" }
```
This is the recommended default state after this build lands — see the "Feature complete"
recommendation in `AI_CONTENT_FACTORY_IMPLEMENTATION.md`.

**To hide the feature entirely from non-technical admins** (UI-level rollback, no data
changes): remove/comment the `"content-factory"` page key from the relevant admin role's
default pages in `src/constants/adminPages.js`, or unassign it per-admin in the existing
role/permissions UI. The routes/controllers remain functional (protected by
`authenticateAdmin` + `requirePage("content-factory")`) — this only removes the nav entry
and page-level access, it does not disable any backend logic.

**To stop the Bull repeatables from firing at all** (e.g. during a Redis migration or
incident): the simplest option is `automationStatus: PAUSED` (above) — the repeatable still
fires on schedule but is a fast, cheap no-op. If you specifically need to remove the
repeatable jobs themselves from Redis, use Bull's `removeRepeatable()` API with the same
cron string via a one-off script/REPL against `contentFactoryPlanningQueue`/
`contentFactoryFreshnessQueue` (exported from `contentFactoryQueue.js`) — not required for
normal pause/resume operation.

**Nothing needs to be reverted in the existing `Blogs` collection.** Content Factory-created
posts are ordinary `Blogs` documents distinguishable only by a non-null
`sourceOpportunityId` — they can be filtered, edited, unpublished, or deleted through the
exact same existing admin blog tools as any manually-authored post.

## Production Validation

A code-level audit of the feature-complete factory was performed against
`claude/current-blog-plan-a7wjyi` in a sandbox with **no `MONGO_DB`, `REDIS_URL`, or
`ANTHROPIC_API_KEY`** — every safety mechanism described above (pause gating, budget
auto-pause, human-approval-only publish, topic-cluster admin-confirmation) was verified by
reading the real source and tracing every code path by hand, plus the full existing/extended
automated test suite (142/142 passing). **None of the following was run** — they require real
credentials against a real environment and must be completed by an operator before flipping
`automationStatus` to `"ENABLED"` in production. This is a runbook, not a report of results —
check items off as you complete them for real.

### Pre-launch live-data validation checklist

Complete in order. Each step assumes `MONGO_DB`, `REDIS_URL`, and `ANTHROPIC_API_KEY` are set
in the target environment (staging strongly preferred over production for the first pass).

1. **Confirm the app boots clean against real infra.**
   - [ ] `npm run start` connects to Mongo and Redis with no errors; server logs show
     `scheduleContentFactoryRepeatables()` registering both cron jobs (`content-factory-planning`,
     `content-factory-freshness`) without duplicate-repeatable errors.
   - [ ] `GET /admin/content-factory/settings` returns a singleton doc with
     `automationStatus: "PAUSED"` (the code default — confirm it wasn't manually flipped by a
     prior session/migration).

2. **Topic clusters — first real mapping.**
   - [ ] Admin UI → Topic Clusters → "Propose Mapping". Confirm the proposal reads real
     `Course.category` values from the live catalog (not a fixture) and that **nothing** is
     written to `TopicCluster` until you click "Apply".
   - [ ] Review the proposed clusters for sanity against the real category taxonomy — this is
     the one step in the whole pipeline that has never been checked against real data before
     this launch. Hand-edit names/categories if the AI's grouping is off before applying.
   - [ ] Apply, then confirm `GET /admin/content-factory/clusters` shows the applied set.

3. **Course priority — first real aggregation.**
   - [ ] Trigger `recomputePriority` (or wait for the first planning run). Spot-check the
     top-5 and bottom-5 scored courses against your own business intuition — do the courses
     you'd expect to be prioritized (high enquiry/revenue/views) actually land in
     `TIER_1_STRATEGIC`/`TIER_2_GROWTH`?
   - [ ] Confirm `gscClicks28d`/`gscImpressions28d` are still 0 for every course (documented M1
     limitation — no course↔URL mapping exists yet) unless that's been separately addressed
     since this doc was written.

4. **Dry-run planning — zero-risk first real pass.**
   - [ ] Dashboard → "Run Dry-Run Plan Now". Confirm it creates scored `ContentOpportunity`
     docs and a `ContentRun` log entry, and creates **zero** `Blogs` documents (check
     `Blogs.countDocuments()` before/after — should be unchanged).
   - [ ] Run it a second time immediately after. Confirm it does not create near-duplicate
     opportunities for the same course/content-type pairing it just created (the
     pre-AI-call `scoreDuplicateRisk()` dedup should suppress this).
   - [ ] Spot-check 5-10 of the generated opportunities' `title`/`recommendationReason`/
     `topicAngle` fields for real editorial sanity (not gibberish, actually relevant to the
     course).

5. **One real generation → review → approve cycle, end to end.**
   - [ ] Pick a single low-stakes opportunity. `POST /opportunities/:id/generate`. Watch the
     job ledger (`GET /jobs/:id`) step through BRIEF → ARTICLE → SEO → LINKS → IMAGE_PROMPT →
     QUALITY_GATE in real time.
   - [ ] Confirm it lands in `HUMAN_REVIEW` or `NEEDS_REVISION` — never anything further along
     — with no human action taken yet.
   - [ ] Open it in Human Review. Editorially read the full article — check for genuine
     factual accuracy (spot-check 2-3 of the fact-checker's `findings` against the actual
     sourceUrl), check the internal links actually resolve to real course/blog pages, check the
     image concept prompt/alt-text/filename are sensible.
   - [ ] If flagged (`NEEDS_REVISION`), confirm exactly one automatic revision pass happened
     (check `autoRevisionCount === 1` and two `ContentQualityScore` docs exist for the
     opportunity) before it reached human review.
   - [ ] Click Approve & Schedule with a near-future date. Confirm the resulting `Blogs` doc has
     `published: true` and the correct `scheduledAt`. Confirm it does **not** appear on the
     public `/blogs` listing yet (still in the future).
   - [ ] Wait until `scheduledAt` passes (or set it a minute in the future for this test).
     Confirm the post now appears on the public site with no manual action taken.

6. **Budget guard — one real forced breach.**
   - [ ] Temporarily set `dailyAiBudgetUsd` very low (e.g. `$0.01`) via `PATCH /settings`.
   - [ ] Trigger any AI-consuming action (dry-run, generate, etc.) and confirm
     `automationStatus` flips to `PAUSED`, `pausedReason` is set, and the configured
     `MAIL_TO` address actually receives the pause-notification email.
   - [ ] Confirm manual/interactive actions (generate, review, approve) still work while
     paused — only the daily planning job's automatic path should be blocked.
   - [ ] Restore a realistic `dailyAiBudgetUsd` and re-enable automation before continuing.

7. **Trend research and SEO gap analysis — first real signals.**
   - [ ] Confirm `SeoGscMetric` has real synced rows before expecting non-empty gap results
     (`analyzeContentGaps()` returns `{gaps: []}` on an empty/unsynced GSC connection — that's
     correct behavior, not a bug, but means nothing to review until GSC sync has run at least
     once).
   - [ ] Trigger a real planning run (not dry-run) and confirm `researchTrends()` makes at most
     `maxDailyResearchCalls` real Claude calls (check `GET /usage` afterward for a `trendResearch`
     `callType` count), and that every returned trend genuinely has a real `sourceUrls` entry —
     spot check a few by opening the URLs.

8. **Final go/no-go review.**
   - [ ] Everything above passed with no unexpected findings.
   - [ ] Decide the real `autoGenerateArticles`/`maxDailyArticles` starting values (recommended:
     start with `autoGenerateArticles: false` so the daily job only creates opportunities, and
     generation stays a manual per-item action, until you're confident in article quality at
     scale — see the PILOT-tier discussion in `AI_CONTENT_FACTORY_IMPLEMENTATION.md`).
   - [ ] Only then set `automationStatus: "ENABLED"`.

Nothing above was executed in this validation pass — the sandbox this audit ran in has no
`MONGO_DB`/`REDIS_URL`/`ANTHROPIC_API_KEY`. All 8 steps remain outstanding for whoever owns the
production launch.
