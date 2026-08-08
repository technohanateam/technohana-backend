# AI Content Factory — Implementation

Scales blog content production across 350+ courses without becoming a low-quality
volume mill: decides *what* to publish next (course priority, topic clusters, dedup),
drafts it through a brief→article→SEO→links→image pipeline (M2+), runs quality/fact
checks (M3+), and puts every piece in front of a human before it can be approved,
scheduled, or published. The existing blog system (`Blogs` model, `AdminBlogs.jsx`,
`admin.routes.js` blog endpoints) remains canonical and is never forked or
auto-published into — the factory ultimately creates ordinary `Blogs` drafts via the
existing creation/publish/schedule code paths.

## Key design decisions

| # | Question | Decision |
|---|---|---|
| a | Course settings storage | New 1:1 collection `CourseContentSettings` keyed by `courseSlug`, **not** fields on `course.model.js` — that model is overwritten wholesale by `sync-prices`' raw file copy, so anything living there would get silently dropped on next sync. |
| b | Audit log | (M2+) New `ContentFactoryAuditLog` + `logContentFactoryAudit()`, modeled 1:1 on the existing `seoAuditLog.model.js`/`seoAuditLogger.js` pattern — parallel, not shared, since action shapes differ. |
| c | Approval → real Blog | (M2+) Generation writes to `ContentOpportunity`/`ContentBrief`/`ContentGenerationJob` only. On human **Approve**, a thin controller calls the same internal blog-creation helper `POST /blogs` uses, inserting a normal `Blogs` doc (`published:false`, `sourceOpportunityId` set). Everything after that is 100% existing, untouched code. |
| d | Image generation | (M2+) Prompt/alt-text/filename generation only in this build (`imageConcept.tier: AI_PROMPT_ONLY`, `status: IMAGE_PENDING` always). Real `openai.images.generate()` integration is explicitly deferred, not built. |
| e | Rate limiting | Two separate guards: interactive single-click AI actions go through `contentFactoryAiLimiter` (own bucket, mirrors `adminAiLimiter`). The daily planning job and bulk generation are governed by budget/quota fields in settings, checked in-process before each AI call. |
| f | Nav placement | New page key `content-factory`, own top-level sidebar section "Content Factory" (mirrors the "SEO"/"SEO Intelligence" precedent). Default roles: `admin`, `super_admin`, `marketing` — same level blogs already grants. |

## Milestones

- **Milestone 1 — Foundation** (this doc's "As-built" section below): course priority
  scoring, topic clusters, opportunity generation, duplicate detection, dry-run
  planning, settings/pause controls. **Implemented.**
- **Milestone 2 — Content generation** (brief → article → SEO → links → image prompt).
  **Not yet implemented.**
- **Milestone 3 — Editorial quality** (fact-check, AI-style eval, quality gate,
  revision agent). **Not yet implemented.**
- **Milestone 4 — Calendar + automation** (backlog, calendar, daily planning job, cost
  controls, global pause). **Not yet implemented.**
- **Milestone 5 — Research intelligence** (trends, SEO gaps, freshness) + final
  regression pass. **Not yet implemented.**

---

## As-built — Milestone 1

### Backend — files created

**Models** (`src/models/`)
- `contentFactorySettings.model.js` — singleton settings doc (found via `.findOne()`,
  created with defaults on first use via `getOrCreateContentFactorySettings()`,
  mirroring `seoSettings.model.js`'s pattern).
- `topicCluster.model.js`
- `courseContentSettings.model.js`
- `contentOpportunity.model.js` — full field set incl. `duplicateSignals[]`,
  20-value `contentType` enum, `overallScore`; indexes on
  `{status, overallScore}` and `{courseSlug, createdAt}`.
- `contentRun.model.js`

**Services** (`src/services/contentFactory/`)
- `coursePriorityScoring.service.js` — pure function `computeCoursePriorityScore()`,
  no DB/network imports. Verified by inspection: only imports are none (plain JS).
- `coursePriorityAggregation.service.js` — bulk aggregation wrapper
  `refreshCoursePriorities()`. One `Enquiry.aggregate`, one `Order.aggregate`, one
  `CourseView.aggregate`, plus one lookup query for existing settings — no per-course
  loop. Bulk-upserts via `CourseContentSettings.bulkWrite()`. Only recomputes courses
  whose `lastPriorityComputedAt` is null or >24h old, unless `force:true`.
- `topicClusterMapping.service.js` — `proposeTopicClusterMapping()` (one Claude call,
  tier `cheap`, never persists) and `applyTopicClusterMapping()` (persists on
  explicit admin confirmation only).
- `duplicateDetection.service.js` — `scoreDuplicateRisk()`, deterministic
  Jaccard-token-overlap based, no network calls.
- `contentStrategy.service.js` — `generateOpportunityCandidates()` orchestrator, plus
  two pure/unit-testable helpers `isDueForContent()` and `computeOverallScore()`.
  Runs `scoreDuplicateRisk()` on every candidate *before* any AI call, drops
  `HIGH`-cannibalization/near-exact duplicates, then makes exactly ONE batched Claude
  call (tier `standard`) covering every surviving candidate. Creates
  `ContentOpportunity` docs with `status: PLANNED` only.
- `contentFactoryQueue.js` — Bull queue `content-factory-planning`, daily cron
  `0 5 * * *`, imports `SYNC_RETRY_CONFIG` from `seoIntelQueue.js`, checks
  `automationStatus === "PAUSED"` first and no-ops with a logged `ContentRun` if so.

**Prompts** (`src/prompts/contentFactory/`)
- `topicClusterProposal.prompt.js`
- `opportunityCandidateWriter.prompt.js`
- `duplicateAlternativeAngle.prompt.js` — built for completeness per the plan; not
  called by anything in M1, wired up starting M2/M3.

**Middleware**
- `middleware/contentFactoryAiLimiter.js` — own rate-limit bucket (20/hr, keyed by
  `req.admin?.uid`), cloned from `adminAiLimiter`'s config.

**Controllers** (`src/controllers/contentFactory/`)
- `contentFactorySettings.controller.js` — `getSettings`, `updateSettings`,
  `toggleAutomation`.
- `courseIntelligence.controller.js` — `listCourses`, `updateCourseSettings`,
  `recomputePriority`.
- `topicCluster.controller.js` — `listClusters`, `createCluster`, `updateCluster`,
  `deleteCluster`, `proposeMapping`, `applyMapping`.
- `contentOpportunity.controller.js` — `listOpportunities`, `getOpportunity`,
  `runDryRunPlan`, `listRuns`, `rejectOpportunity`, `overrideScore`.

**Routes**
- `routes/contentFactory.routes.js` — every route `authenticateAdmin` +
  `requirePage("content-factory")`; settings/toggle/course-update/cluster-mutations/
  apply-mapping/dry-run/recompute-priority additionally require `requireAdmin`;
  read-only list routes require `requireMarketing` (matches blogs' permission level).
  AI-adjacent routes (`propose-mapping`, `dry-run`, `recompute-priority`) also pass
  through `contentFactoryAiLimiter`.

### Backend — files modified

- `src/services/aiAgent.service.js` — `callClaude()` now accepts `tier`
  (`"cheap"` → `claude-haiku-4-5-20251001`, `"standard"` → `claude-sonnet-4-6`,
  default `"standard"`) and returns `{ text, usage, model }` instead of a bare
  string. **Breaking change**, propagated to every existing caller:
  - `src/services/leadScoringAgent.js`
  - `src/services/recoveryEmailAgent.js`
  - `src/services/campaignCopywriterAgent.js`
  - `src/services/atRiskLearnerAgent.js`
  - `src/controllers/crmLead.controller.js` (4 call sites)
- `src/index.js` — imports + mounts `contentFactoryRoutes` at
  `/admin/content-factory`; imports + calls `scheduleContentFactoryRepeatables()` at
  boot, in the same dedupe-safe dynamic-import pattern used for
  `scheduleSeoIntelRepeatables`/`scheduleBacklinkRepeatables`.
- `src/constants/adminPages.js` — added `"content-factory"` to `ADMIN_PAGES` and to
  the `marketing` role's `DEFAULT_PAGES_BY_ROLE` entry.

### Frontend — files created

- `src/pages/admin/contentFactory/ContentFactoryDashboard.jsx`
- `src/pages/admin/contentFactory/CourseIntelligence.jsx`
- `src/pages/admin/contentFactory/ContentOpportunities.jsx`
- `src/pages/admin/contentFactory/TopicClusters.jsx`
- `src/components/admin/contentFactory/ContentFactoryLayout.jsx`

### Frontend — files modified

- `src/lib/adminAccess.js` — added `content-factory` registry entry (section
  "Content Factory") and to marketing's default pages.
- `src/components/AdminLayout.jsx` — new "Content Factory" nav section, 4 links.
- `src/App.jsx` — 4 new lazy-imported `AdminOnlyRoute pageKey="content-factory"`
  routes.
- `src/services/adminService.js` — added content-factory HTTP functions.

### Deviations from the literal plan

1. **GSC/GA4 signals default to 0.** `SeoGscMetric`/`SeoGa4Metric` exist and were
   confirmed, but both are keyed by page URL (`dimensionType: "page"/"landingPage"`,
   `dimensionValue` = the URL), not by `courseSlug`/`courseId`. There is no stored
   mapping from a course to its canonical page URL to join against without guessing
   at a URL pattern, so `gscClicks28d`/`gscImpressions28d` are hardcoded to 0 in
   `coursePriorityAggregation.service.js` for M1, per the plan's explicit fallback
   instruction ("if you can't confirm their exact shape... default those two signals
   to 0"). Wiring a real join is a candidate for M4/M5 once a course↔URL mapping
   exists.
2. **`recomputePriority` recomputes all courses, not a single course.** The plan
   allows "one course or all"; `refreshCoursePriorities()` is a bulk, no-N+1
   aggregation by design (a handful of total queries), so there's no cheap
   single-course code path without either a per-course query (defeating the
   no-N+1 requirement) or a second bespoke function. M1 ships the bulk path only;
   the controller ignores any single-course `courseSlug` the client might send.
   Revisit in a later milestone if single-course recompute proves necessary.
3. **`CourseView` model is a named export**, not the repo's usual default-export
   convention for models (`export const CourseView = mongoose.model(...)` in
   `courseView.model.js`) — noted here since it's easy to import wrong; the new code
   imports it correctly as `{ CourseView }`.
4. **6 existing `callClaude()` callers fixed, not 2.** The plan named
   `leadScoringAgent.js`/`recoveryEmailAgent.js` explicitly; a repo-wide grep found
   4 more call sites (`campaignCopywriterAgent.js`, `atRiskLearnerAgent.js`, and 4
   sites inside `crmLead.controller.js`) that also needed the `.text` destructure
   fix for the breaking return-shape change. All 6 files were updated in this
   milestone so nothing is left broken.

### Verification performed

- `computeCoursePriorityScore()` (in `coursePriorityScoring.service.js`) has zero
  imports — confirmed by reading the file — so it is a pure function with no DB/network
  dependency, callable with plain object inputs.
- `contentFactory.routes.js` — every route passes through
  `authenticateAdmin, requirePage("content-factory")` (applied once via
  `router.use(...)` at the top of the file, before any route is declared); mutating
  routes additionally require `requireAdmin`; AI-adjacent routes additionally pass
  through `contentFactoryAiLimiter`.
- `runDryRunPlan` → `generateOpportunityCandidates()` never imports or calls
  `Blogs.create`/`Blogs.save`/any Blogs write path — the only Blogs interaction in
  the whole M1 codebase is a **read-only** `Blogs.find(...)` in
  `contentStrategy.service.js`'s `loadExistingCorpus()`, used purely for duplicate
  detection.
- No file under `src/pages/admin/AdminBlogs.jsx`, `src/models/blogs.model.js`, or any
  existing blog route/controller was touched in this milestone.

## As-built — Milestone 2 (Content generation: brief → article → SEO → links → image prompt)

### Files created (backend, `technohana-backend`)
- `src/models/contentBrief.model.js`, `src/models/contentGenerationJob.model.js`
- `src/services/blogCreation.service.js` — extracted `createBlogFromPayload()`
- `src/services/contentFactory/seoThresholds.js`, `contentBriefWriter.service.js`,
  `articleWriter.service.js`, `seoFieldWriter.service.js`, `internalLinker.service.js`,
  `imagePromptWriter.service.js`, `contentGenerationOrchestrator.service.js`,
  `contentGenerationQueue.js`
- `src/prompts/contentFactory/{contentBrief,articleWriter,seoFieldWriter,internalLinker,imagePromptWriter}.prompt.js`
- `src/controllers/contentFactory/{contentGeneration,humanReview}.controller.js`

### Files modified (backend)
- `src/models/contentOpportunity.model.js` — additive `imageConcept`, `articleDraft`
  (mirrors Blogs 1:1, plus convenience `focusKeyword`/`author`/`category` fields not on
  the Blogs schema itself — needed so `approve()` can populate a new Blogs doc without
  re-deriving them), `humanRevisionNote`, `generationAttempts`.
- `src/models/blogs.model.js` — additive `sourceOpportunityId` ref. Nothing else touched.
- `src/routes/admin.routes.js` — **only** the `POST /blogs` handler body was replaced with
  a call to `createBlogFromPayload()`; every other route (`generate-from-course`,
  `generate-from-urls`, `rewrite`, `auto-seo`, `auto-schedule`, `bulk-publish`,
  `bulk-delete`, `seed-static`, `upload-image`, `PUT/DELETE/PATCH /blogs/:id`) is
  byte-identical to before this milestone.
- `src/routes/contentFactory.routes.js` — added generate/jobs/review routes.

### Files created/modified (frontend, `technohana-frontend-master`)
- New: `src/pages/admin/contentFactory/HumanReview.jsx`,
  `src/components/admin/contentFactory/{ReviewModal,GenerationJobStatus}.jsx`
- Modified: `src/pages/admin/AdminBlogs.jsx` (see decision below), `src/services/adminService.js`
  (new content-factory M2 functions, none duplicated — `rejectContentOpportunity` from M1
  and the new `rejectReviewItem` hit different endpoints for different flows),
  `src/pages/admin/contentFactory/ContentOpportunities.jsx` (Generate Article button
  enabled), `src/components/admin/contentFactory/ContentFactoryLayout.jsx` (5th tab),
  `src/components/AdminLayout.jsx` (nav link), `src/App.jsx` (route).

### `BlogModal` export decision
Exported `BlogModal` as a **named export** from `AdminBlogs.jsx` (`export { BlogModal }`
alongside the existing `export default AdminBlogs`) and imported it directly into the new
`ReviewModal.jsx`, extended with an additive `reviewContext` prop. This was viable — the
grep for `from ".../AdminBlogs"` found zero other consumers of the default export outside
`App.jsx`'s lazy route import — so option 1 (reuse) from the plan was taken as preferred;
no fallback fork was needed. When `reviewContext` is `undefined`, every new branch is
skipped and the component's tab list, submit handler, and footer buttons render exactly as
before — the only always-present addition is a read-only "AI Factory" badge on rows where
`blog.sourceOpportunityId` is truthy.

### Blog-creation extraction (`POST /blogs`)
`createBlogFromPayload()` in the new `src/services/blogCreation.service.js` is a direct,
line-for-line move of the original inline handler body (same validation order — title
required, then slug generation, then collision check — same defaults, same field mapping),
wrapped so failures throw `Error` with `.statusCode`/`.message` instead of writing the
response directly. The route handler now does:
```js
try {
  const blog = await createBlogFromPayload(req.body);
  return res.status(201).json({ data: blog });
} catch (err) {
  if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
  ...
}
```
which reproduces the exact same status codes/response bodies (`400`/"Title is required.",
`409`/"A blog with this slug already exists.", `201`/`{ data: blog }`) as before. The XSS
sanitizer inside the service is an intentional duplicate of `admin.routes.js`'s local
`XSS_OPTIONS` (same whitelist/attribute rules) rather than an import from the route file,
to avoid an awkward router→service→router dependency; `PUT /blogs/:id` and the other blog
routes keep using their own untouched local `sanitizeContent`.

### Article writer reuse
`articleWriter.service.js` is a deliberate **copy**, not a refactor, of
`generate-from-course`'s web_search agentic loop (same `axios` call shape, same
`web_search_20260209` tool declaration, same turn-loop/stop-reason handling), reparameterized
to build its prompt from a `ContentBrief` (headings/questions/examples/depth) instead of raw
course fields. `generate-from-course`, `generate-from-urls`, `rewrite`, `auto-seo`,
`auto-schedule`, `bulk-publish`, `bulk-delete`, `seed-static`, `upload-image` were not
touched at all in this milestone.

### Image generation
Confirmed prompt-only: `imagePromptWriter.service.js` never calls an images API.
`imageConcept.tier` is always `"AI_PROMPT_ONLY"`, `imageConcept.imageUrl` is always `null`,
`imageConcept.status` is always `"IMAGE_PENDING"` (both on success and on the built-in
fallback path when the AI concept call itself fails — the generator never throws, so a
failed image-concept call can never block article completion).

### Approve → Blogs, and the `approve`/`approve-and-schedule` endpoint decision
A **single** `POST /review/:opportunityId/approve` endpoint handles both "Approve" and
"Approve & Schedule" — an optional `scheduledAt` in the body sets `Blogs.scheduledAt`
directly after `createBlogFromPayload()` returns (a plain field set + `.save()`, which is
all `PATCH /blogs/:id/publish` does for scheduling too, so no extra reuse was needed there).
A second dedicated route was intentionally not added, to keep the review action surface
small; the frontend's "Approve & Schedule" button is the same call with a date filled in.
Slug collisions are handled with a numeric suffix (`-2`, `-3`, ...) rather than failing the
approval outright.

### Orchestrator / job ledger
`contentGenerationOrchestrator.service.js` sequences BRIEF → ARTICLE → SEO → LINKS →
IMAGE_PROMPT, persisting `articleDraft`/`imageConcept` onto the opportunity after every
step (so partial work always survives a later failure), and recording
tokens/model/estimated cost per step onto `ContentGenerationJob.steps[]`. On any step
failure the pipeline stops immediately (no steps run with missing upstream data), the job
and opportunity both flip to `FAILED` with `errorMessage`/`retryCount`/`lastAttemptAt` set,
and the function returns `{ success: false, ... }` rather than throwing further —
`generateOpportunityArticle`/`regenerateReview` controllers never see an unhandled
rejection from this path. `retryFromStep(jobId, stepName)` resumes from the requested step
using the already-persisted `ContentBrief`/`articleDraft`/`imageConcept`, never
regenerating steps that already succeeded. `QUALITY_GATE` exists on the
`ContentGenerationJob` step-name enum for M3 forward-compat only — it is never added to a
job's `steps[]` or run in this milestone; M2 always routes a fully-succeeded pipeline
straight to `HUMAN_REVIEW`, skipping `AI_REVIEW`.

### Verification performed
- `node --check` on every new/modified backend file — all pass.
- Backend `npm test` — all 75 pre-existing tests (backlink + seo-intel suites) still pass
  unmodified; no content-factory test target existed to extend (same as M1's precedent —
  no `tests/content-factory/**` directory was added, since none of M1's either).
- Frontend `npm run build` — succeeds; `npx eslint` on every new/modified frontend file
  reports zero new problems (two pre-existing `no-unused-vars` errors in
  `AdminLayout.jsx`/`AdminBlogs.jsx`, confirmed via `git stash` to predate this milestone,
  were left as-is per the "don't fix pre-existing unrelated failures" instruction).
- Manually re-read the diff of `POST /blogs` before/after extraction line-by-line to confirm
  identical validation order, defaults, and response shapes.
- Confirmed via grep that no route among `generate-from-course`, `generate-from-urls`,
  `rewrite`, `auto-seo`, `auto-schedule`, `bulk-publish`, `bulk-delete`, `seed-static`,
  `upload-image` appears in this milestone's diff.

## As-built — Milestone 3

Editorial quality: fact-check, AI-style eval, quality gate, revision agent, full human
review UI (AI Quality tab, revision history), bulk review actions.

### `claudeWebSearchLoop.js` extraction decision — **extracted, not duplicated a third time**
The plan flagged this as a judgment call ("extract only if zero behavior change; otherwise
write a fresh, smaller duplicate"). Decision: **extracted** `utils/claudeWebSearchLoop.js`
from `admin.routes.js`'s `POST /admin/blogs/generate-from-course` handler, and switched
that route to call it.

Why this was safe to do (not the same situation M2 faced with `articleWriter.service.js`):
the loop in `generate-from-course` is a **self-contained, parameter-free block** — it reads
`system`/`userPrompt`/`apiKey` from local closures and returns nothing but `finalText`
(everything downstream — JSON parsing, response shape — lives outside the loop and was left
completely untouched). Unlike M2's `articleWriter.service.js`, which needed a *different*
call shape (return `usage`/`model` alongside text, brief-aware prompt), this extraction
needed **zero interface change** at the call site — same inputs (`apiKey`, `system`,
`prompt`, hardcoded `model`/`maxTokens`/`maxTurns`/`timeout` values passed through
unchanged), same output consumed the same way (`if (!finalText) return res.status(500)...`).
Verified byte-identical behavior by comparing the pre/post diff line-by-line: same
`axios.post` URL/headers/body shape, same turn cap (5), same timeout (120000ms), same
stop-reason branches (`end_turn` extracts text and breaks, `tool_use` continues, anything
else breaks with empty `finalText`), same message-history append behavior. The util also
returns `usage`/`model`/`turns` for callers that want them (factChecker.service.js does);
the extracted `generate-from-course` call site simply doesn't destructure those fields, so
its behavior is unaffected.

`articleWriter.service.js` (M2) was **not** touched — it keeps its own inline copy of the
loop exactly as M2 left it, per the explicit instruction not to touch it. So there are now
two consumers of the shared util (`generate-from-course` and `factChecker.service.js`) and
one still-independent copy (`articleWriter.service.js`) — this is intentional, not an
oversight.

### Quality gate composition (`qualityGate.service.js`)
`computeQualityGateResult(scores, settings)` is a **pure function** — no imports of
mongoose models, `aiAgent.service.js`, or any network client inside that specific function
(verified: it only touches its own module-level `WEIGHTS`/`TOTAL_WEIGHT` constants and the
arguments passed in). Unit tests in `tests/content-factory/qualityGate.test.js` call it with
plain objects only.

`overallScore` is a weighted average of all dimensions except `aiStyleRiskScore`, which is
folded in **inverted** (`100 - aiStyleRiskScore`) rather than treated as a pure separate
gate — it still *also* gates independently (see below), so it counts twice by design: once
as a component of the composite score, once as its own hard threshold. Weights (documented
in the module, sum to 100): `factualityScore` 15 (highest — accuracy is the highest-stakes
dimension), `seoScore`/`originalityScore`/`courseRelevanceScore` 10 each,
`readabilityScore`/`searchIntentAlignmentScore`/`specificityScore`/`originalInsightScore` 8
each, `internalLinksScore`/`ctaRelevanceScore`/`editorialQualityScore` 6 each,
`aiStyleRiskScore` (inverted) 5.

`flaggedForRevision` is true when `aiStyleRiskScore > settings.aiStyleRiskThreshold` **OR**
`overallScore < settings.overallScoreFloor`, exactly per spec. `overallScoreFloor` did not
already exist on `contentFactorySettings.model.js` — added additively, default `60`.

Two dimensions are computed **deterministically instead of asking the AI**, per the plan's
explicit instruction not to re-ask the model for something computable:
- `seoScore` — reuses `seoThresholds.js`'s existing 50-60/140-160 char ranges (same source
  the editor UI's SEO checklist uses), scored as 5 equal-weight checks (focus keyword set,
  meta title in range, meta description in range, excerpt filled in, tags.length >= 3 — the
  last one swapped in for "featured image set" since a cover image isn't part of
  `articleDraft` and image generation is prompt-only in this project).
- `internalLinksScore` — reuses `internalLinker.service.js`'s own target ranges (2-5 course
  links, 1-4 blog links) against the actual `suggestedInternalLinks` counts already on the
  draft.

The remaining 8 dimensions (originality, readability, courseRelevance,
searchIntentAlignment, ctaRelevance, specificity, originalInsight, editorialQuality) come
from **one combined** `standard`-tier Claude call (`qualityEvaluator.prompt.js`) — kept to
one call rather than one call per dimension, per the plan's cost-consciousness. `factuality`
comes from the fact-checker's findings (`verifiable count / total count * 100`, defaulting
to 80 when an article makes no checkable claims — a neutral-good default rather than
penalizing an article that simply didn't take factual risks). `aiStyleRiskScore` comes from
its own dedicated cheap-tier call.

### Fact-checker (`factChecker.service.js`)
One Claude call with `web_search_20260209` tool access via the shared loop util (internally
may take several search turns — from the orchestrator's point of view it's one
`QUALITY_GATE`-step sub-call). Never fabricates a source: a finding is only trusted as
`verifiable: true` if the model both claims `verifiable:true` **and** supplied a
`sourceUrl` — a `verifiable:true` claim missing a `sourceUrl` is downgraded to `false` with
an explanatory note rather than trusted at face value. Failures (parse errors, no final
response) never throw up into the quality gate — they resolve to an empty findings list plus
an `error` field, so a fact-checker failure can never block the rest of the quality gate the
way a hard throw would.

### AI-style evaluator (`aiStyleEvaluator.service.js`)
One `cheap`-tier call, scores `aiStyleRiskScore` 0-100 (higher = more
generic/formulaic/AI-sounding — formulaic transitions, generic hedging, repetitive
structure, generic intro/conclusion patterns). `flagReasons` only populated when the score
is elevated (>= 30), matching the plan's "reasons only populated when score is elevated"
requirement.

### Revision agent (`revisionAgent.service.js`) — cap and sanity check
`reviseArticle(articleDraft, qualityScoreResult, brief, opts)` is a `standard`-tier call
instructed to genuinely restructure flagged sections (explicit anti-synonym-swap
instruction, strengthened further on the retry — see `revisionAgent.prompt.js`'s `stronger`
branch). `sources`, `faqs`, and `suggestedInternalLinks` are force-preserved from the
original draft in `mergeRevision()` regardless of what the model returns — belt-and-suspenders
on top of the prompt instruction, never trusting the model alone not to touch them.

Sanity check: a dependency-free Sorensen-Dice similarity over character bigrams
(`diceSimilarity`) compares normalized (HTML-stripped, lowercased, whitespace-collapsed)
before/after `content`. Above `0.9` similarity, the revision is judged "basically
unchanged" and a second attempt runs with a strengthened prompt. If the second attempt is
*also* above the threshold, `reviseArticle` gives up gracefully — returns the
less-similar of the two attempts plus a `note` explaining automatic revision couldn't
substantially change the draft, rather than looping indefinitely. **Hard cap: exactly 2
Claude calls per `reviseArticle()` invocation, always.**

### Orchestrator wiring and the automatic-revision cap (no infinite loop)
`contentGenerationOrchestrator.service.js`'s `STEP_ORDER` now ends in `QUALITY_GATE`. Inside
that step:
1. `runQualityGate(opportunity._id, articleDraft)` runs once.
2. **Only if** `flaggedForRevision` **and** `opportunity.autoRevisionCount === 0`:
   `reviseArticle()` runs (bounded to 2 Claude calls, see above), `autoRevisionCount` is
   incremented to `1`, a `REVISION` entry is appended to `job.steps[]` (not part of the
   fixed `STEP_ORDER` since it's conditional — `REVISION` was added additively to
   `ContentGenerationJob`'s step-name enum), and `runQualityGate` runs a **second and final**
   time on the revised draft.
3. Whatever the last `runQualityGate` result was becomes `qualityGateOutcome`, consumed
   after the loop to set the opportunity's final status: `NEEDS_REVISION` if still flagged
   (with `humanRevisionNote` summarizing the flag reasons so the reason is visible without
   opening the quality tab), `HUMAN_REVIEW` otherwise.

**No infinite loop is possible**: `runQualityGate` is called at most twice per pipeline run
(step 1, and once more only inside the `autoRevisionCount === 0` branch — which can only be
true once per run, since it's set to `1` synchronously before that branch's `runQualityGate`
call). `reviseArticle` itself is hard-capped at 2 Claude calls regardless of how similar its
output is. There is no retry-on-still-flagged behavior anywhere in the automatic path — a
still-flagged draft after the one revision pass goes straight to `NEEDS_REVISION`, it is
never fed back into another automatic revision attempt.

`autoRevisionCount` resets to `0` on a full pipeline restart (`runGenerationPipeline` — a
brand-new article draft gets its own fresh automatic-revision allowance) but is left
untouched by `retryFromStep` (a partial resume continues working on the same draft, so the
cap must persist across it) and is **never** touched by the human-requested revision path
(`requestRevision` controller — see below), consistent with the plan's "the cap is only for
the fully-automatic pass; a human explicitly asking again is a new, allowed action".

Both `ContentQualityScore` docs from an auto-revision pass are kept (never overwritten) —
`generationAttempt` is derived from `ContentQualityScore.countDocuments({opportunityId}) + 1`
inside `runQualityGate`, so the second call within the same pipeline run naturally gets
`generationAttempt: 2`, giving the review UI (`RevisionDiff.jsx`) a real before/after to
show.

### Human-requested revision (`humanReview.controller.js` — `request-revision`)
Now a real endpoint instead of the M2 stub: loads the latest `ContentQualityScore` (for
`flagReasons`/`factCheckFindings` context) and the `ContentBrief`, calls
`reviseArticle(draft, qualityScoreResult, brief, { humanNote })` with the human's note
merged in as additional prompt context (see `revisionAgent.prompt.js`'s `humanNote`
section). Explicitly does **not** touch `opportunity.autoRevisionCount` — this path is
unlimited by design, a human can request revision as many times as they want. After
revision, status is set back to `HUMAN_REVIEW` (never auto-approved) so the human re-checks
the result before approving.

### Bulk actions and server-side re-validation
`POST /review/bulk-approve` loops over the given ids and, **for each one individually**,
calls `assertApprovable(opportunity)` before calling the same `approveOpportunityCore()`
function the single `approve` endpoint uses (no forked approval logic) — `assertApprovable`
independently re-checks both the opportunity's `status` (must be `HUMAN_REVIEW`/`AI_REVIEW`)
**and** queries the latest `ContentQualityScore` doc's `flaggedForRevision` field itself,
never trusting anything the client sent about which items are "safe". Anything that fails
either check is pushed to a `skipped: [{id, reason}]` array in the response rather than
being silently included or causing the whole batch to fail — verified by manually
constructing a request with a known-`NEEDS_REVISION` id mixed into an otherwise-valid `ids`
array and confirming it comes back in `skipped` with the real approved items still
succeeding. `POST /review/bulk-reject` and `POST /review/bulk-regenerate` follow the same
per-id-not-trusting-the-client shape (though reject doesn't need quality-gate
re-validation — rejecting a flagged item is always safe).

### Frontend — AI Quality tab, revision history, bulk action bar
`ReviewModal.jsx` now threads `qualityScore`, `qualityScoreHistory`, and
`autoRevisionCount` through `reviewContext` (the `GET /review/:id` controller response was
extended server-side to include the latest `ContentQualityScore` plus the full
`qualityScoreHistory` array, rather than adding a second dedicated endpoint, per plan
guidance). `AdminBlogs.jsx`'s `BlogModal` "AI Quality" tab (still inside the pre-existing
additive `reviewContext` branch — the non-`reviewContext` path is untouched) now renders a
new `QualityTab` component: dimension score grid with green ≥ 80 / amber 50-79 / red < 50
thresholds (`aiStyleRiskScore` colored inverted since lower is better), `flagReasons` list,
`factCheckFindings` list with a green check (verifiable) or amber warning (unverifiable)
icon per finding, and — only when `autoRevisionCount > 0` — a `RevisionDiff.jsx` component
showing the first vs. last `ContentQualityScore` docs' numbers side by side with a
"still flagged for: X" note. Kept intentionally simple (numbers side-by-side, not a text
diff library) per the plan's explicit "simpler is fine here" guidance.

`HumanReview.jsx` gained checkbox-based multi-select and a floating bulk action bar
(Bulk Approve / Bulk Regenerate / Bulk Reject), visually matching `AdminBlogs.jsx`'s
existing bulk bar (`fixed bottom-4 ... bg-gray-900 text-white rounded-2xl shadow-2xl`
pattern, read directly from that file before building this one). Bulk Approve gives a
client-side heads-up (amber warning count) for any selected row whose `status` is
`NEEDS_REVISION` — but the click is never blocked; the server is the actual authority and
reports back which ids were skipped and why.

### Additive schema changes
- `contentQualityScore.model.js` — new collection, one doc per generation attempt.
- `contentFactorySettings.model.js` — `overallScoreFloor` (default `60`), additive.
- `contentOpportunity.model.js` — `autoRevisionCount` (default `0`), additive.
- `contentGenerationJob.model.js` — `REVISION` added to the step-name enum, additive.

### Verification performed
- `node --check` on every new/modified backend file — all pass.
- Backend `npm test` — 81 tests pass (the pre-existing 75 backlink/seo-intel tests
  unmodified, plus 6 new pure-function tests for `computeQualityGateResult` in
  `tests/content-factory/qualityGate.test.js`, added to the `test` script's glob).
- Frontend `npm run build` — succeeds. `npx eslint` on every new/modified frontend file —
  zero new problems (one pre-existing `no-unused-vars` in `AdminBlogs.jsx`'s
  `handleGenerateLinks`, confirmed unrelated to this milestone's changes, left as-is).
  Frontend `npm test` (vitest) — same 3 pre-existing failures as baseline
  (`AdminSeoExecutiveDashboard`/`ConnectPropertyDialog`/`SeoKpiCard`, all SEO-dashboard
  tests unrelated to content-factory, confirmed via grep that none reference
  `contentFactory`/`AdminBlogs`/`ReviewModal`), no new failures introduced.
- Traced the full path manually: generate → QUALITY_GATE scores it → if flagged, exactly one
  auto-revision → re-score → NEEDS_REVISION (still flagged, both `ContentQualityScore` docs
  visible) or HUMAN_REVIEW (no longer flagged) → confirmed no code path re-enters the
  automatic revision branch for the same pipeline run.
- Confirmed `computeQualityGateResult` has zero imports of mongoose models, `aiAgent.service.js`,
  or `axios`/`callClaude` anywhere in `qualityGate.service.js`'s pure-function section (only
  the orchestrating `runQualityGate` function below it does DB/network work).
