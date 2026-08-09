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
  revision agent). **Implemented.**
- **Milestone 4 — Calendar + automation** (backlog, calendar, daily planning job, cost
  controls, global pause). **Implemented.**
- **Milestone 5 — Research intelligence** (trends, SEO gaps, freshness) + final
  regression pass. **Implemented — see "As-built — Milestone 5" below. Project complete.**

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

## As-built — Milestone 4 (Calendar + automation: backlog, calendar, daily planning job, cost controls, global pause)

This milestone was **resumed** after a prior agent hit a session limit mid-work with real,
uncommitted files already sitting in the working tree. Before writing anything new, every
uncommitted file was read in full and verified against the plan rather than trusted at face
value.

### What the prior partial work already covered (verified correct, kept as-is)
- `src/models/aiUsageLog.model.js` — complete: `date`/`callType`/`model`/`tier`/`tokensIn`/
  `tokensOut`/`estimatedCostUsd`/`opportunityId`/`jobId`, indexed on `{date, callType}`.
- `src/services/contentFactory/aiUsageTracker.service.js` — complete: `recordAiUsage()` (writes
  an `AiUsageLog` row + rolls `ContentFactorySettings.todaySpendUsd` forward, resetting on a new
  `todaySpendDate`, wrapped in try/catch so logging failures never break the caller's actual AI
  result) and `trackedCallClaude()` (drop-in `callClaude()` wrapper).
- `src/services/contentFactory/budgetGuard.service.js` — complete: pure `checkBudget(settings,
  proposedCallEstimateUsd)` (verified genuinely pure — no imports beyond the settings model's
  factory function and `sendEmail`, neither invoked inside `checkBudget` itself; see the new
  unit tests below) and DB-touching `enforceBudgetOrPause()` which sets `automationStatus:PAUSED`,
  `pausedReason:"DAILY_AI_BUDGET_EXCEEDED"`, and emails `MAIL_TO` via the existing `sendEmail()` —
  idempotent (won't re-email if already paused for that exact reason).
- `src/services/contentFactory/trendResearch.service.js` / `contentGapAnalysis.service.js` — both
  correct M4-scope stubs (`{trends:[]}` / `{gaps:[]}`, zero AI/network calls), left untouched;
  real logic is Milestone 5.
- `contentFactorySettings.model.js`, `aiStyleEvaluator.service.js`, `contentBriefWriter.service.js`,
  `imagePromptWriter.service.js`, `internalLinker.service.js`, `qualityGate.service.js`,
  `revisionAgent.service.js`, `seoFieldWriter.service.js`, `topicClusterMapping.service.js` — all
  nine files' `callClaude()` → `trackedCallClaude()` conversions were re-read line-by-line and
  found **fully correct**: right `callType` string per call site, `opportunityId`/`jobId` correctly
  threaded through from each caller's own arguments, no leftover raw `callClaude(` imports, no
  broken imports. Nothing needed fixing here — the prior agent's work on this list was complete
  and accurate.

### What this milestone added — remaining `trackedCallClaude`/cost-logging conversions
- `contentStrategy.service.js` — the one remaining raw `callClaude()` call (M1's batched
  candidate-writer call) converted to `trackedCallClaude(..., callType: "opportunityCandidates")`.
- `factChecker.service.js` and `articleWriter.service.js` — both use the agentic
  `web_search_20260209` loop pattern (the former via the shared `utils/claudeWebSearchLoop.js`,
  the latter via its own inline axios loop, per the M2/M3 "notable deviations" decision) rather
  than the simple `callClaude()` shape, so neither routes through `trackedCallClaude()` directly —
  per the plan, that's fine as long as each still logs its own `AiUsageLog` row. Both now call
  `recordAiUsage()` directly after their loop completes, with the loop's accumulated
  `tokensIn`/`tokensOut` (`callType: "factCheck"` / `callType: "article"`), so cost visibility
  isn't lost for what's likely the single most expensive step in the pipeline (`articleWriter`).
- Grepped the entirety of `src/services/contentFactory/**` for `callClaude(` afterward: zero
  remaining call sites outside `aiUsageTracker.service.js` itself (which legitimately wraps the
  raw function) and explanatory comments.

### What was fully new in this milestone
**Backend services**
- `contentFactory/contentBacklog.service.js` — `getBacklog({page,limit})` (paginated
  `ContentOpportunity` docs with `status` in `APPROVED`/`SCHEDULED` whose `resultingBlogId`
  points to a `Blogs` doc with `scheduledAt:null`), `recommendScheduleDate(opportunity,
  existingCalendarEntries, settings)` (pure — no DB access inside; unit-tested, see below), and
  `getBacklogWithRecommendations()` (DB wrapper: loads the backlog + scheduled `Blogs` for the
  next 30 days joined back to their source opportunity's `clusterId`, then calls the pure
  recommender per item).
- `contentFactory/contentCalendar.service.js` — `getCalendar({month})`, `scheduleOpportunity()`,
  `rescheduleOpportunity()`, `unscheduleOpportunity()`. See "Existing blog-scheduling semantics"
  below for the exact mechanism this file matches.
- `contentFactory/dailyPlanningJob.processor.js` — `runDailyPlanningJob()`, the complete §30
  sequence: (1) PAUSED check (absorbed from `contentFactoryQueue.js`'s old inline check — not
  duplicated), (2)+(mid-run) `enforceBudgetOrPause()` re-checked before each further
  AI-consuming phase, (3) `refreshCoursePriorities({force:false})`, (4) `researchTrends()` stub,
  (5) `analyzeContentGaps()` stub, (6) `generateOpportunityCandidates({dryRun:false})`, (7)
  optional auto-generation of the top `maxDailyArticles` newly-created `PLANNED` opportunities by
  `overallScore` via `enqueueGeneration()` when `settings.autoGenerateArticles===true` (default
  `false`) — with the budget re-checked again before each individual enqueue in the loop, (8)
  final `ContentRun` counts written back.
- `contentFactoryQueue.js` — refactored so its Bull `.process()` calls
  `runDailyPlanningJob()` instead of inlining the PAUSED check + calling
  `generateOpportunityCandidates()` directly; added `enqueuePlanningRunNow()` for the manual
  trigger endpoint (same processor, `triggeredBy:"MANUAL"`).

**Backend controllers/routes** (all under the existing `authenticateAdmin, requirePage
("content-factory")` guard already applied at the top of `contentFactory.routes.js`)
- `contentFactory/contentCalendar.controller.js` — `GET /calendar`, `POST
  /calendar/:opportunityId/{schedule,reschedule,unschedule}`, all `requireMarketing` (matches
  blog scheduling's existing permission level).
- `contentFactory/contentBacklog.controller.js` — `GET /backlog`, `requireMarketing`.
- `contentFactory/costControls.controller.js` — `GET /usage?range=today|7d|30d`, `requireAdmin`
  (financial data) — a single Mongo aggregation pipeline per breakdown (by day, by callType, and
  totals), not N+1 reads.
- `contentFactory/planning.controller.js` — `POST /plan/run-now`, `requireAdmin`, enqueues
  `runDailyPlanningJob` immediately via the existing queue rather than waiting for the cron.

**Frontend**
- `src/pages/admin/contentFactory/ContentCalendar.jsx` — hand-built CSS-grid month view (no
  calendar library is a dependency in this project — checked `package.json` first, per the
  plan's explicit instruction — so no new dependency was added). Click an item to
  reschedule (date input) or unschedule via a small modal.
- `src/pages/admin/contentFactory/ContentBacklog.jsx` — paginated approved-not-scheduled list;
  each row shows the backend's `recommendedDate` with a one-click "Use Recommended" button, plus
  a manual date override input + Schedule button.
- Added as tabs 6/7 ("Calendar", "Backlog") in `ContentFactoryLayout.jsx`, matching routes in
  `App.jsx` (component renamed to `ContentFactoryCalendar` on import to avoid a name collision
  with the pre-existing public `ContentCalendar` page at `/content-calendar`), and nav entries in
  `AdminLayout.jsx`'s existing "Content Factory" section — no new `pageKey`/registry entry needed
  since `content-factory` already exists.
- `ContentFactoryDashboard.jsx` — added a today's-AI-spend progress-bar widget (color escalates
  green→amber→red as spend approaches the daily budget), a red "paused due to budget" banner
  (shown only when `pausedReason==="DAILY_AI_BUDGET_EXCEEDED"`, with a "Re-enable Automation"
  button reusing the existing automation toggle), and a separate "Run Planning Job Now" button
  (calls `POST /plan/run-now`) placed in its own card, explicitly distinct from the pre-existing
  "Run Dry-Run Plan Now" button — dry-run never touches `Blogs`/generation; run-now is the real
  planning job and may (only if `autoGenerateArticles` is on) trigger real generation.
- `adminService.js` — added `fetchContentCalendar`, `scheduleContentFactoryItem`,
  `rescheduleContentFactoryItem`, `unscheduleContentFactoryItem`, `fetchContentBacklog`,
  `fetchAiUsage`, `runPlanningJobNow`.

### Existing blog-scheduling semantics — what was actually found

Read before writing `contentCalendar.service.js`, as required: `blog.controller.js`'s public
`getAllBlogs()`/`getBlogBySlug()`, `admin.routes.js`'s `PATCH /blogs/:id/publish`, and
`POST /blogs/auto-schedule`.

**Finding: there is no cron or background job that flips `published` when `scheduledAt`
arrives.** The public read paths gate visibility purely at query time —
`Blogs.find({ published: true, $or: [{scheduledAt:null},{scheduledAt:{$lte:now}}] })` — so a
post only ever "goes live at its scheduledAt" if `published` is **already `true`** and
`scheduledAt` is set to a moment that has now passed. Both existing endpoints that schedule
posts (`PATCH /blogs/:id/publish` and `POST /blogs/auto-schedule`) always set `published: true`
together with `scheduledAt`, confirming this is the one real mechanism — there is no second,
different scheduling pathway anywhere else in the codebase.

`contentCalendar.service.js`'s `scheduleOpportunity()`/`rescheduleOpportunity()` therefore always
pair `scheduledAt` with `published: true` when writing to the resulting `Blogs` doc, exactly
mirroring this confirmed mechanism, so items scheduled from the new Calendar/Backlog UI go live
identically to any other existing scheduled post. `unscheduleOpportunity()` sets both
`scheduledAt: null` and `published: false` (reverting a scheduled item back to an unpublished
draft, not leaving it published-with-no-date, which would make it go live immediately under the
same query-time gate).

**Note — a discrepancy found in already-committed M2/M3 code, not touched by this milestone:**
`humanReview.controller.js`'s `approveOpportunityCore()` (Milestone 2) sets `scheduledAt` when
the reviewer passes it to "Approve & Schedule" but leaves `blog.published` at its default
`false`. Given the mechanism above, a post approved-and-scheduled that way will **not** actually
go live at its `scheduledAt` — it stays a draft until someone separately flips `published` via
the existing `PATCH /blogs/:id/publish` toggle. This is out of Milestone 4's scope (a M2/M3 file,
not on the M4 file list, and M1-M3 are explicitly "committed and pushed — do not touch"), so it
was left as-is and is flagged here for whoever picks up Milestone 5 or a future bugfix pass —
the fix would be a one-line addition (`blog.published = true;` alongside the existing
`if (scheduledAt) blog.scheduledAt = ...` line) if it turns out to be an actual oversight rather
than intentional (e.g. "approved and scheduled" meaning "reserved a date, still needs a final
manual publish click" as a deliberate extra safety gate — this doc doesn't assume either reading,
just reports the mechanism as found).

### Critical constraint verification — `autoGenerateArticles` never bypasses human review

Traced explicitly: `dailyPlanningJob.processor.js` step (7) only runs when
`settings.autoGenerateArticles === true` (schema default `false`, confirmed in
`contentFactorySettings.model.js`). Even when true, it does exactly one thing per selected
opportunity — flips its status to `SELECTED` and calls `enqueueGeneration(opp._id)`, which adds
a job to `contentGenerationQueue` (Milestone 2). That queue's processor calls
`runGenerationPipeline()` in `contentGenerationOrchestrator.service.js` (Milestone 2/3, unmodified
by M4), whose `runSteps()` function — traced line-by-line — only ever sets the opportunity's
final `status` to `NEEDS_REVISION` or `HUMAN_REVIEW` after the `QUALITY_GATE` step; there is no
code path anywhere in that orchestrator, in M4's new files, or in `humanReview.controller.js`
that sets `status: "APPROVED"`/creates a `Blogs` doc without an explicit human hitting one of the
`POST /review/:opportunityId/{approve,bulk-approve}` endpoints. `autoGenerateArticles` therefore
only ever controls whether generation is **auto-triggered** — never whether a human reviews it.

### Additive schema changes
- `contentFactorySettings.model.js` — `todaySpendDate` (String, default `null`), additive; added
  by the prior agent's partial work, verified correct (used by `aiUsageTracker.service.js` to
  detect day rollover before incrementing `todaySpendUsd`).
- `aiUsageLog.model.js` — entirely new collection (Milestone 4 scope per the plan).

### Verification performed
- `node --check` on every new/modified backend file — all pass.
- Backend `npm test` — **89 tests pass**: the pre-existing 81 seo-intel/backlink/content-factory
  tests (including the 6 `qualityGate.test.js` content-factory tests from M3) unmodified, plus
  8 new pure-function tests added this milestone:
  `tests/content-factory/budgetGuard.test.js` (4 tests for `checkBudget()` — under-budget allow,
  over-budget block, missing-fields-default-to-zero, zero-proposed-cost still checks current
  spend) and `tests/content-factory/contentBacklog.test.js` (4 tests for
  `recommendScheduleDate()` — returns a date ≥ tomorrow, skips a day already at `softMax`, avoids
  a same-cluster collision on an under-`softMax` day, and a determinism/purity check that
  identical inputs produce identical output).
- Confirmed `checkBudget()` is genuinely pure by inspection (only imports are the settings
  factory function and `sendEmail`, and `checkBudget` itself calls neither — only
  `enforceBudgetOrPause` does) and by the unit tests above exercising it with plain objects only,
  no DB connection required to run them.
- Confirmed `recommendScheduleDate()` is pure/near-pure by inspection (`existingCalendarEntries`
  and `settings` are both parameters, no DB import anywhere in `contentBacklog.service.js`'s
  function itself — only `getBacklogWithRecommendations()`, the separate DB wrapper, touches
  Mongo) and by the determinism unit test above.
- Frontend `npm run build` — succeeds (398 course pages regenerated by `postbuild` as usual).
  `npx eslint` on every new/modified frontend file — zero new problems (one pre-existing,
  unrelated `no-unused-vars` in `AdminLayout.jsx` confirmed present on the pre-M4 commit via
  `git stash`, left as-is). Frontend `npm test` (vitest) — same 3 pre-existing baseline failures
  as the M3 doc recorded (`AdminSeoExecutiveDashboard`/`ConnectPropertyDialog`/`SeoKpiCard`, all
  SEO-dashboard tests unrelated to content-factory), no new failures introduced.
- `dist/`/`public/sitemap.xml` build-artifact drift from `npm run build` was discarded via
  `git checkout -- dist public/sitemap.xml` before staging anything, per the plan's explicit
  standing instruction (this has apparently happened on every prior milestone) — confirmed via
  `git status` afterward that only real source files remain modified/untracked.
- Traced the full automation path manually (see "Critical constraint verification" above):
  planning job runs → respects PAUSED (step 1, absorbed from the old inline queue check) →
  respects budget (step 2 + mid-run re-checks) → creates opportunities (step 6, M1's existing
  logic, untouched) → (only if `autoGenerateArticles`) triggers generation for the top N by
  score (step 7) → those still land in `NEEDS_REVISION`/`HUMAN_REVIEW`, never
  auto-approved/published (M2/M3's orchestrator, unmodified).

---

## As-built — Milestone 5

Milestone 5 replaces the M4 stubs with real trend research and SEO gap analysis, adds a
weekly content-freshness scan, wires the resulting signals into opportunity scoring, and
runs the final full-project regression pass.

### Backend — files created

- `src/services/contentFactory/contentFreshness.service.js` — `runFreshnessScan()` (weekly
  Bull job) plus two pure helpers, `classifyBlogFreshness()` and `worstStatus()`.
- `src/prompts/contentFactory/trendResearch.prompt.js` — system/user prompt for the
  per-cluster web-search call, anti-fabrication rules mirrored from
  `factChecker.prompt.js`.
- `tests/content-factory/trendResearch.test.js`, `contentGapAnalysis.test.js`,
  `contentFreshness.test.js` — unit tests for every new pure function.

`contentGapAnalysis.prompt.js` was **not** created — see "Content-gap approach" below for
why a Claude call was judged unnecessary for that step.

### Backend — files modified (stub → real implementation)

- `src/services/contentFactory/trendResearch.service.js` — `researchTrends()` now makes
  ONE batched `runClaudeWebSearchLoop()` call per `TopicCluster` (never per-course), capped
  by `settings.maxDailyResearchCalls`. Returns
  `{trends: [{topic, summary, sourceUrls, cluster, clusterId, matchedCourses}]}`. Also
  exports two pure functions: `matchTrendToCourses(trend, courseCatalogSummary, threshold)`
  (Jaccard token-overlap scoring, default threshold `0.3`, no DB/network) and
  `buildCourseTrendScoreMap(trends)` (reduces to `{courseSlug: 0-100}`, best trend wins per
  course).
- `src/services/contentFactory/contentGapAnalysis.service.js` — `analyzeContentGaps()` now
  reads `SeoGscMetric` (`dimensionType:"query"`, `impressions >= 100` default,
  `ctr < 0.02` default) with **zero** AI/network calls. Returns
  `{gaps: [{query, impressions, ctr, matchedCourses, suggestedAngle}]}`. Exports pure
  `matchGapQueryToCourses()`, `buildSuggestedAngle()` (deterministic template), and
  `buildCourseGapSignalMap(gaps)` (reduces to `{courseSlug: {seoOpportunityScore, query}}`).
- `src/services/contentFactory/dailyPlanningJob.processor.js` — step (4)/(5) now call the
  real services instead of stubs; step (6) builds `trendScoreMap`/`gapSignalsByCourse` via
  the two `buildCourse*Map()` helpers and passes them into
  `generateOpportunityCandidates()`. The run's `trendsSummary`/`gapsSummary` (top 5 each,
  by matched-course-count / impressions respectively) are attached to the `ContentRun`
  before it saves, so the dashboard widgets can read them off the existing `GET /runs`
  fetch — no new endpoint needed.
- `src/services/contentFactory/contentStrategy.service.js` — `generateOpportunityCandidates()`
  gained two **optional** params, `trendScoreMap`/`gapSignalsByCourse` (default `{}`, so
  every pre-M5 caller/test is unaffected). `computeOverallScore()` gained an optional
  `trendScore` param and now weights
  `courseRelevanceScore*0.28 + businessIntentScore*0.22 + seoOpportunityScore*0.15 + coursePriorityScore*0.25 + trendScore*0.1`
  (previously `0.3/0.25/0.15/0.3`, `seoOpportunityScore` always `0`) — still sums to 1.0,
  still multiplied by the same duplicate-penalty factor. Newly created `ContentOpportunity`
  docs now store a real `trendScore` field (was always schema-default `0`).
- `src/models/topicCluster.model.js` — additive `lastResearchedAt: Date` (used to
  prioritize which clusters get a research call when there are more clusters than
  `maxDailyResearchCalls` allows).
- `src/models/contentFactorySettings.model.js` — additive
  `freshnessSensitiveKeywords: [String]`, default
  `["AI","GPT","Claude","certification","pricing","AWS","Azure","GCP"]`, admin-editable via
  the existing `PATCH /settings` endpoint (no new route needed).
- `src/models/contentRun.model.js` — additive `trendsSummary`/`gapsSummary`
  (`[Schema.Types.Mixed]`, default `[]`).
- `src/models/blogs.model.js` — additive `lastReviewedAt: { type: Date, default: null }`.
  Nothing else in this file touched.
- `src/services/contentFactory/contentFactoryQueue.js` — new
  `contentFactoryFreshnessQueue` (own Bull queue, same `QUEUE_SETTINGS`/logging pattern as
  the planning queue), weekly repeatable added inside
  `scheduleContentFactoryRepeatables()` alongside the existing daily one.

### Trend-research batching approach and cost-cap handling

One Claude call per `TopicCluster` (read via `TopicCluster.find()`), never per-course — with
~10-15 clusters vs 350+ courses this keeps AI spend bounded regardless of catalog growth,
per the plan's hard cost-control requirement. `settings.maxDailyResearchCalls` (default 15)
hard-caps how many cluster calls run in a single `researchTrends()` invocation:
`selectClustersForResearch()` sorts eligible clusters by `priority` descending, then by
`lastResearchedAt` ascending (never-researched clusters — `null` — sort first) as the
tiebreaker, and slices to the cap. Budget is also re-checked via `enforceBudgetOrPause()`
**before every individual cluster call** (not just once at the top of the job) — a real
paid-call loop can legitimately breach the daily budget partway through, and the loop stops
early (keeping whatever trends were already found) rather than continuing to spend. Any
trend the model reports with zero real `sourceUrls` (i.e. it couldn't back the claim with an
actual search result) is dropped entirely — mirrors `factChecker.service.js`'s "never keep
an unfounded claim" rule, applied here as "never keep an unsourced trend."

### Content-gap-analysis approach: deterministic, not AI-assisted

Purely deterministic aggregation — **no Claude call**, and `contentGapAnalysis.prompt.js`
was deliberately not created. Reasoning: "high impressions + low CTR" is already a
mechanically detectable signal straight out of `SeoGscMetric` (real visibility, weak
engagement); turning that into a `suggestedAngle` is a fixed template
(`"<query>" already gets N impressions but only X% CTR — create/refresh content ...`), not a
judgment call that benefits from an LLM's creativity. Adding a Claude call here would add
cost, latency, and a new failure mode (parse errors, fabrication risk) without adding signal
quality — the raw aggregation is already the useful output. `matchGapQueryToCourses()` reuses
the same token-overlap approach as `matchTrendToCourses()` but is kept as its own small pure
function (mirrors `duplicateDetection.service.js`'s precedent of a self-contained scoring fn
per service) since a GSC query string and an AI-generated trend object are different enough
inputs that sharing one function would need an awkward adapter.

### Content-freshness classification and course-linkage handling

`classifyBlogFreshness(blog, keywords, now)` (pure) computes `ageDays` from
`lastReviewedAt || updatedAt || createdAt`, checks the blog's `category`/`tags`/`title`
against the admin-editable `freshnessSensitiveKeywords` list (case-insensitive substring
match), and applies one of two threshold sets: standard (`FRESH ≤90d`, `REVIEW ≤180d`,
else `OUTDATED`) or sensitive (`FRESH ≤45d`, `REVIEW ≤120d`, else `OUTDATED`) — fast-moving
topics (AI/cloud/pricing/certifications) age out roughly twice as fast. `runFreshnessScan()`
links each published blog to a course two ways, in order: (1) `sourceOpportunityId` →
`ContentOpportunity.courseSlug` (factory-originated posts — exact linkage), (2) best-effort
fallback for pre-factory/manually-authored posts with no `sourceOpportunityId`: match
`blog.category` to every `Course` sharing that exact category (case-insensitive), applying
the blog's status to all of them. **Blogs matching neither path contribute to no course's
freshness score** — they're still counted in the run's `statusCounts`/`unmatchedBlogs`
summary for visibility, but no `CourseContentSettings` doc is touched for them (there's no
reliable course to attribute an uncategorized/unlinked post to). Per course, `worstStatus()`
takes the single worst status among all its linked blogs (one stale post is enough to flag a
course) and writes `freshnessStatus`/`lastFreshnessCheckedAt` — the **only** two fields this
scan ever writes; blog `content` is never touched, matching the plan's "flags for human
review, never edits" constraint.

### Frontend changes

- `CourseIntelligence.jsx` — new "Freshness" column (badge: green Fresh / amber Review
  Recommended / red Outdated) reading `row.freshnessStatus`, which
  `courseIntelligence.controller.js`'s `listCourses()` was **already** returning since M1
  (confirmed by reading the controller — no backend change was needed here, only the
  frontend table was missing the column).
- `ContentFactoryDashboard.jsx` — two new read-only widgets, "Trending This Week" and "Top
  SEO Gap Opportunities," both sourced from the most recent `PLANNING` `ContentRun`'s
  `trendsSummary`/`gapsSummary` (already fetched by the existing `fetchContentRuns()` call —
  no new `adminService.js` function or backend endpoint was needed). Both link to the
  existing Opportunities page (no cluster-filter query param exists on that page yet, so the
  link is a plain navigation, per the plan's "otherwise just display" fallback).

### Verification performed

- `node --check` on every new/modified backend file — all pass.
- Backend `npm test` (`node --test tests/seo-intel/**/*.test.js tests/backlink/**/*.test.js
  tests/content-factory/**/*.test.js`) — **108 tests pass, 0 fail** (was 89 after M4; +19 new
  Milestone 5 tests across the three new test files, all pure-function coverage with no DB
  connection required).
- Backend has no `lint`/`build` npm scripts (plain Node service, no bundler/TS) — `npm test`
  plus `node --check` are the verification gates, consistent with M1-M4.
- Frontend `npm run build` — succeeds (398 course pages regenerated by `postbuild` as usual).
  `dist/`/`public/sitemap.xml` drift discarded via `git checkout -- dist public/sitemap.xml`
  before anything was staged, confirmed via `git status` afterward.
- Frontend `npx eslint` on the two changed files — zero problems. Full `npm run lint` across
  the whole frontend repo shows pre-existing errors confined to the separate
  `technohana-mobile/` React Native app and `vite.config.js` (`process`/`__dirname` globals) —
  none in any content-factory file, none newly introduced by this milestone.
- Frontend `npm test` (vitest) — same 3 pre-existing baseline failures as recorded in the M3/M4
  docs (`AdminSeoExecutiveDashboard`/`ConnectPropertyDialog`/`SeoKpiCard`, all SEO-dashboard
  tests unrelated to content-factory) — confirmed pre-existing via `git stash` (failures
  identical with and without this milestone's changes applied), no new failures.
- Full final regression pass — see the dedicated checklist in the project report; every item
  confirmed by reading the actual route/component code (no live server available in this
  environment).
- Grepped `src/` for `images.generate`/`image.generate`/`generateImage`/`dall-e`/`DALL` —
  the only real hits are `generateImageConcept()` in `imagePromptWriter.service.js` (which
  itself contains no OpenAI/image-API import or call — it's a Claude text call producing a
  prompt/alt-text/filename triple only) and course-catalog data mentioning "DALL-E" as
  course content, plus one blog-seed fixture string — zero actual image-generation API calls
  anywhere in the project, confirmed by reading `imagePromptWriter.service.js` in full.

---

## Production validation + pilot readiness (2026-08-08)

A live validation pass was run against the **real production database and real
Anthropic/OpenAI credentials** (not a staging copy) — every finding below is from
actually executing the code, not re-reading it. `automationStatus` was `PAUSED` at the
start and was left `PAUSED` at the end; no article was ever approved or published.

### Scheduling-visibility regression proof (live, not just unit tests)

Created one disposable, clearly-tagged test post directly via the `Blogs` model and
checked all three public retrieval paths (`GET /blogs`, `GET /blogs/:slug`, and the
SSR/OG-crawler `GET /blog/:slug`) at each state, then deleted it:

| State | In `/blogs` list | `/blogs/:slug` 200 | SSR route leaks title |
|---|---|---|---|
| draft (`published:false`) | No | No | No |
| `published:true`, `scheduledAt` **future** (+24h) | **No** | **No** | **No** |
| `published:true`, `scheduledAt` **past** (-24h) | Yes | Yes | Yes |
| deleted | No | No | No |

All four states passed. This is the strongest possible confirmation of the earlier
`buildPublicBlogFilter()` fix — proven against the real running route handlers, not a
mock.

### Real defects found and fixed during this pass

1. **Course priority scores were nearly uniform across all 425 real courses**
   (scores 10-11, everything `TIER_4_LONG_TAIL`, zero usable differentiation). Root
   cause: `DEFAULT_CAPS.courseViews90d` (5000) and `enquiryCount90d` (40) were guesses
   made with no real distribution to calibrate against — against actual data
   (catalogue-wide 90-day views ≈2,300, and most `Enquiry.courseTitle` values are
   generic labels like "General Enquiry" rather than real course names), both signals
   normalized to near-zero for every course, and the score degenerated to whatever
   `recency` alone contributed — itself uniform since only 19 blogs exist across 425
   courses. **Fix:** `coursePriorityAggregation.service.js` now computes the actual
   observed max per signal each run and passes dynamic caps into
   `computeCoursePriorityScore()` (extended with an optional third `caps` param,
   backward compatible — `DEFAULT_CAPS` remains the floor for sparse data). Re-run
   against the same real data produced genuine differentiation (scores 10-27, sensible
   top courses: LangChain Fundamentals, SOC Analyst, Claude API/Anthropic Platform,
   MS-102). Regression tests added: `tests/content-factory/coursePriorityScoring.test.js`.
   **Not fixed, flagged for the business:** `Enquiry.courseTitle` data quality — most
   enquiry records don't carry a real course name, which limits how much the enquiry
   signal can ever contribute regardless of scoring logic. This is a lead-capture form
   data-entry issue, out of Content Factory's scope to fix in code.
2. **The batched opportunity-candidate Claude call truncated mid-JSON at real batch
   size** (20 candidates, the real `maxDailyOpportunities`) — `maxTokens: 4096` was a
   fixed value that didn't scale with batch size. **Fix:**
   `contentStrategy.service.js` now sizes `maxTokens` proportionally
   (`Math.min(8192, Math.max(2048, 1024 + survivors.length * 350))`). Re-run
   successfully created all 20 real opportunities with zero `Blogs` writes.
3. **`parseModelJson` failed on a real content-brief response** containing a literal,
   unescaped `"` inside a string value (a heading with a quoted phrase) — the existing
   control-char repair pass's quote-boundary tracking ended the string early.
   **Fix:** added a fallback second repair pass (`escapeStrayQuotesInStrings`), only
   invoked when the first parse attempt fails, so well-formed responses are completely
   unaffected. Regression tests added: `tests/content-factory/parseModelJson.test.js`
   (includes the exact real failure pattern).
4. **`articleWriter.service.js`'s per-turn timeout (120000ms, matching the original
   `generate-from-course` route) was insufficient** for brief-driven generation in 2 of
   3 initial real attempts. Raised to 180000ms in this file only (a deliberate,
   independent copy — `generate-from-course` itself was not touched). Even at 180s,
   articles for 2 of 2 subsequent real attempts still didn't complete before the
   session hit real Anthropic credit exhaustion (see below) — whether 180s is
   sufficient in practice under normal (non-credit-exhausted) conditions could not be
   fully confirmed in this session and should be re-checked once real generation
   resumes.

Every fix above: `node --check` clean, full test suite re-run green after each
(`128/128` at the end, up from `117/117` at the start of this pass — 11 new regression
tests added), zero regressions to any pre-existing content-factory or blog behavior.

### Real system behavior observed under genuine failure conditions

Across 6 real generation attempts (2 batches of 3), the session's Anthropic API
account ran out of credits mid-pilot (`"Your credit balance is too low to access the
Anthropic API"`) — a real external/billing blocker, not a code defect, and outside
this session's authority to resolve. This is valuable evidence in its own right: even
under real, unplanned failure conditions (network timeouts, then an actual API
rejection), **every `ContentGenerationJob` correctly recorded `status:"FAILED"` with
the real error message, every subsequent step correctly stayed `PENDING` (never
fabricated as complete), and zero corrupted or partial-fake articles were ever
persisted** — confirming the "never persist corrupt records, fail safely" design
property under genuine adverse conditions, not just synthetic unit tests. These 6 real
`ContentGenerationJob`/opportunity records are left in the database exactly as they
failed; once API credits are restored, the existing `[Retry]`/regenerate UI actions can
resume them with the fixes above already in place.

Total real AI cost incurred during this entire validation pass: **$0.30** (per
`AiUsageLog`, cross-checked exactly against `ContentFactorySettings.todaySpendUsd` —
confirming the cost-tracking wiring itself is accurate against real usage), covering 1
topic-cluster proposal, 2 opportunity-candidate batches, and 5 content-brief attempts
(4 successful). Well within the $20/day default budget.

### Topic clusters (live)

Proposed against the real 51 distinct course categories: 8 clusters (AI & GenAI,
Cloud & DevOps, Data & Analytics, Business Applications & Integration, Cybersecurity &
Compliance, Business & Agile, Development & Automation, Industry-Specific Tech),
programmatically verified to cover all 51 categories exactly once (zero gaps, zero
duplicates). Priorities sensibly reflect the business's actual stated AI/GenAI
positioning (95, highest) down to the long-tail industry-vertical catch-all (70,
lowest). Reviewed and applied — this is now the real, live cluster set.

### Duplicate/cannibalization detection (live)

Tested against the real 19-post blog corpus with three cases: an exact-title repeat of
a real post (`EXACT_DUPLICATE`, score 100, `HIGH`), a reworded title on the same real
topic (`KEYWORD_CANNIBALIZATION`, score 67, `MEDIUM`), and a genuinely unrelated new
topic (score 0, `NONE`, no false positive). All three fired exactly as designed.

### Content opportunities (live, post-fix)

20 real opportunities generated from real course + real cluster data, zero `Blogs`
writes, zero incorrect duplicate flags. Strongest opportunities cluster around AI &
GenAI (Claude API, Agentic AI Engineering, LangChain — well-aligned with the
company's positioning) and Cybersecurity (CISSP, AWS Security Specialty); all 20 came
back as `contentType: COURSE_GUIDE` — a real, worth-noting lack of type diversity in
this particular run's candidate-picking logic (plausibly because every one of these
courses has zero prior blog coverage, where `COURSE_GUIDE` is a reasonable default
first article — but worth watching in subsequent runs once courses have existing
coverage to diversify against).

### Content briefs (live, partial pilot)

4 real content briefs were generated successfully before the credit exhaustion
(Claude API Developer Guide, CISSP, MS-900, and one from the pre-fix batch). All four
show genuinely specific, non-generic headings and reader questions (e.g. the MS-900
brief explicitly frames "is this worth it vs. MS-102/SC-900" rather than a generic
syllabus list; the CISSP brief's angle centers on the specific "think like a manager"
exam-mindset shift rather than restating the 8 domains). This is real evidence the
planning/briefing layer produces specific, useful output — but **no full article
completed generation in this session**, so the end-to-end writing-quality,
AI-style-risk, and quality-gate pass/fail behavior against a real article could not be
directly observed here. This remains open until API credits are restored and a
generation run is retried.

### Editorial voice profile (added this pass)

Found missing entirely as a shared concept — `articleWriter.prompt.js` had its own
inline style prose, `aiStyleEvaluator.prompt.js` had an independent, differently-worded
"avoid" list, and `revisionAgent.prompt.js` had no voice guidance at all, so the three
could silently drift out of sync. Added `src/prompts/contentFactory/editorialProfile.js`
(plain module, not a DB model — lightweight per the plan) defining VOICE/AUDIENCE/
PREFER/AVOID once, wired into all three prompts via `buildEditorialProfileBlock()`.

### PILOT automation status — evaluated, not added

`automationStatus` is checked in exactly one place in the entire codebase
(`dailyPlanningJob.processor.js`), and the settings a `PILOT` mode would need
(`autoGenerateArticles`, `maxDailyArticles`) already exist independently of
`automationStatus`. A third enum value would be purely redundant with
`ENABLED + autoGenerateArticles:true + maxDailyArticles:5` — zero new capability for
real schema/UI/controller cost. Not added, per the plan's own explicit fallback
instruction. See "Recommended pilot configuration" below for the equivalent using
existing settings.

### Recommended pilot configuration (using existing settings, no new status needed)

```json
PATCH /admin/content-factory/settings
{
  "autoGenerateArticles": true,
  "maxDailyArticles": 5,
  "maxDailyOpportunities": 20,
  "dailyAiBudgetUsd": 5
}
```
Then `POST /settings/toggle-automation { "automationStatus": "ENABLED" }` when ready.
Human approval and the absence of automatic publishing are structural — true
regardless of any of these settings.

### Final recommendation from this pass

**GO WITH PILOT — with one hard precondition: restore Anthropic API credits and
successfully complete at least one full article generation (through the quality gate)
before enabling `autoGenerateArticles` or scheduling anything live.** Every layer
proven reachable in this session (scheduling-visibility, priority scoring, topic
clusters, duplicate detection, opportunity generation, cost tracking, safe-failure
behavior) is now genuinely correct against real production data, not just
unit-tested. The one layer that could not be fully validated end-to-end — full article
generation through fact-check/AI-style/quality-gate/human-review — has real, promising
partial evidence (4 solid content briefs, zero corrupted records under real failure)
but no complete real article to inspect. `automationStatus` remains `PAUSED`.

---

## Feature complete — all 5 milestones

The AI Content Factory is now fully built across both repos on
`claude/current-blog-plan-a7wjyi`:

1. **Foundation** — course priority scoring/aggregation, topic clusters (admin-confirmed
   mapping, never auto-applied), opportunity generation with pre-AI duplicate detection,
   dry-run planning, settings/global pause.
2. **Content generation** — brief → article (web-search-grounded) → SEO fields → internal
   links → image concept (prompt/alt-text only) pipeline, with per-step job ledger and
   resumable retries; human review + approve writes an ordinary `Blogs` draft via the
   existing creation path.
3. **Editorial quality** — search-grounded fact-checking (never fabricates a source),
   AI-style risk scoring, a composite quality gate, one capped automatic revision pass,
   bulk review actions (server-re-validated, never implies publish).
4. **Calendar + automation** — cost/budget tracking per AI call, automatic pause + admin
   email on budget breach, content backlog with recommended dates, a calendar that writes
   the existing `Blogs.scheduledAt`/`published` fields (no parallel scheduler), the daily
   planning job tying it all together.
5. **Research intelligence** — real per-cluster trend research and deterministic SEO
   gap analysis feeding real `trendScore`/`seoOpportunityScore` signals into opportunity
   ranking, weekly freshness scanning surfaced on Course Intelligence, dashboard
   trend/gap widgets.

**Core safety properties, confirmed end-to-end:**

- **AI never auto-publishes.** Every path that can create/modify a `Blogs` doc (approve,
  bulk-approve, calendar schedule) requires an explicit human action; the daily planning
  job's optional `autoGenerateArticles` flag only ever auto-*triggers generation*, which
  still always lands in `HUMAN_REVIEW`/`NEEDS_REVISION` — traced with no exception found
  anywhere in the orchestrator, controllers, or M4/M5 additions.
- **The existing blog system is untouched.** `AdminBlogs.jsx`'s core list/search/pagination,
  `generate-from-course`/`generate-from-urls`, manual New/Edit/Delete, toolbar actions,
  per-row actions, bulk publish/delete, and cover-image-generate→Cloudinary are all
  byte-identical to their pre-factory behavior (verified by reading the current route/
  component code against the M2 report's "byte-unchanged" claim).
- **Image generation is prompt-only.** Confirmed by a full-repo grep — zero real
  `openai.images.generate()` or equivalent calls exist anywhere in `src/`.
- **Automation defaults to PAUSED.** `contentFactorySettings.model.js`'s
  `automationStatus` schema default is `"PAUSED"`; the daily planning job checks this first,
  before any AI spend.
- **Budget auto-pause exists.** `budgetGuard.service.js`'s `enforceBudgetOrPause()` flips
  automation to `PAUSED` and emails `MAIL_TO` the moment projected spend would exceed
  `dailyAiBudgetUsd`, checked before every AI-consuming phase of the planning job and now
  also before every individual trend-research cluster call (Milestone 5).

**Recommendation:** leave `automationStatus` at its default `PAUSED` after this lands, even
though the code is feature-complete. Nothing about the automated *pipeline mechanics* needs
further engineering work to be correct, but a human should manually walk through one real
dry-run → generate → review → approve cycle against production data (real course catalog,
real GSC data, real topic-cluster mapping) before flipping automation on — topic-cluster
mapping in particular is admin-confirmed but has never been confirmed against the *real*
category taxonomy in a live run, and the trend-research/gap-analysis signals, while now real,
have not yet been observed against real GSC/web-search data end-to-end. Enabling automation
is a one-click reversible action (`POST /settings/toggle-automation`) once that manual pass
is done.

---

## Production Validation

A validation-only audit pass performed against the feature-complete code on
`claude/current-blog-plan-a7wjyi` (backend PR #109 / frontend PR #136). **Hard environment
constraint:** this sandbox has no `MONGO_DB`, `REDIS_URL`, or `ANTHROPIC_API_KEY` configured
(no `.env`, no `mongod` binary). Everything below marked "verified (static)" or "verified
(test)" was actually checked by reading the real source or running the real test suite; nothing
requiring a live DB/API call was fabricated or simulated. `automationStatus` was left at its
default `PAUSED` throughout and remains `PAUSED`.

### What was cross-checked against this doc's own claims
- Every M1-M5 "As-built" claim re-checked file-by-file: models, services, controllers, routes,
  and prompts all exist exactly where documented. `automationStatus` default confirmed
  `"PAUSED"` by reading `contentFactorySettings.model.js` directly (not trusted from this doc).
- Image generation confirmed prompt-only by re-grepping `src/` for
  `images.generate`/`generateImage`/`dall-e`/`DALL` — zero real image-API calls anywhere.
- The M4 "As-built" section's own self-reported discrepancy (`approveOpportunityCore` setting
  `scheduledAt` while leaving `published:false`) was re-verified: it **is** fixed, in
  `humanReview.controller.js`'s `approveOpportunityCore()` (`blog.published = true` whenever
  `scheduledAt` is provided) — commit `7bcee18`. A regression test for this already exists
  (`tests/blog/publicVisibility.test.js`).
- **Discrepancy found and fixed this pass:** `contentCalendar.service.js`'s header comment
  still claimed the above bug was "left untouched... not fixed in this pass" — stale from
  before the M4→post-M5 fix commit landed. Updated the comment to reflect reality (code
  behavior itself was already correct; this was a documentation-accuracy fix only).

### Scheduled-publishing re-audit (§3)
Re-grepped every `Blogs.find`/`findOne`/`aggregate`/`countDocuments` call site across both
repos. `blog.controller.js`'s `getAllBlogs`, `getBlogBySlug`, and `getBlog` (the SSR/OG-crawler
route) all build their query from `buildPublicBlogFilter()` — confirmed by reading the file
directly, not just the existing test. Every admin-only consumer (`admin.routes.js`'s blog
routes, `seo-analytics`, content-factory's calendar/backlog/freshness/internal-linker/strategy
services) sits behind `authenticateAdmin` (verified by reading the actual route declarations)
and is never reachable by an unauthenticated request. Content-factory services that read
unpublished/scheduled `Blogs` docs for internal purposes (`internalLinker.service.js`,
`contentStrategy.service.js`'s duplicate-detection corpus, `contentFreshness.service.js`,
`contentBacklog.service.js`) do so only for admin-side scoring/suggestion logic (title/slug/
category fields feeding an AI prompt or an internal dedup score) — none of them serve that data
back to an unauthenticated caller, so this is a content-quality consideration (e.g.
recommending an internal link to a not-yet-live post — the link target is still gated by the
same public filter) rather than a new exposure path. No new exposure bug was found; no fix was
needed here beyond the stale-comment correction above.

### Human-approval-safety trace (§5)
Traced every code path that can touch a `Blogs` document end-to-end, with file:line citations:
- `contentGenerationOrchestrator.service.js`'s `runSteps()` (lines ~142-227): the pipeline's
  only two possible terminal statuses after `QUALITY_GATE` are `NEEDS_REVISION` (line 219) and
  `HUMAN_REVIEW` (line 225) — no code path sets `APPROVED`/`SCHEDULED` or creates a `Blogs` doc.
- `dailyPlanningJob.processor.js` step (7) (lines 112-147): even with `autoGenerateArticles:true`,
  the loop only calls `ContentOpportunity.updateOne({status:"SELECTED"})` and
  `enqueueGeneration()` — it never calls anything in `humanReview.controller.js`.
- `humanReview.controller.js`'s `approveOpportunityCore()` (lines 208-256) is the **only**
  function anywhere in the codebase that creates a `Blogs` doc from an opportunity, and it is
  only ever invoked from `approveReviewItem` (explicit single approve, line 291) and
  `bulkApproveReview` (line 326) — both admin-authenticated HTTP actions.
- `assertApprovable()` (lines 262-272) — confirmed it re-queries `ContentQualityScore` fresh
  from the DB (`.findOne({opportunityId}).sort({createdAt:-1})`, line 267) rather than trusting
  anything the client sent; `bulkApproveReview` calls it per-id inside its loop (line 319)
  before calling `approveOpportunityCore`.
- `retryFromStep()` (`contentGenerationOrchestrator.service.js` lines 262-300) only resumes
  generation steps from `STEP_ORDER`; it routes through the identical `runSteps()` end-state
  logic as a fresh run, so it cannot skip the human-review gate.
- **Verified (test):** `npm test` passes 142/142, including the existing bulk-approve/
  quality-gate/budget-guard suites that already exercise this logic with plain-object inputs.

### Topic-cluster mechanism audit (§8)
`topicClusterMapping.service.js` read in full: `proposeTopicClusterMapping()` (lines 17-47)
makes one `trackedCallClaude()` call and returns a plain object — it contains no
`TopicCluster.create`/`save`/`bulkWrite` call anywhere in the function. `applyTopicClusterMapping()`
(lines 51-78) is a separate export, only reachable via the explicit `POST
/clusters/apply-mapping` route, and is the only function in the file that writes
`TopicCluster.bulkWrite()`. **Not executable in this sandbox:** running a real mapping proposal
against the actual 350+-course category taxonomy (needs `ANTHROPIC_API_KEY` + `MONGO_DB`). The
matching/similarity logic used elsewhere in the pipeline (duplicate detection, trend-to-course
matching, gap-to-course matching) is pure and was exercised with representative inputs — see the
new `tests/content-factory/pureScoring.test.js` — but topic-cluster proposal itself has no pure
sub-function to sanity-check in isolation (the categorization judgment is entirely inside the
Claude call), so per the plan's explicit guidance, no fabricated "real" mapping was produced.

### Quality/fact-check/trend/cost-control audits (§13/§16/§17/§18/§19/§20/§21)
- **Quality gate** (`qualityGate.service.js`): `computeQualityGateResult()` (lines 54-88) is
  confirmed pure by inspection — no mongoose/network imports touched inside that function.
  Weights sum to 100 (verified: 15+10+10+10+8+8+8+8+6+6+6+5=100). `flaggedForRevision` is
  `aiStyleRiskScore > threshold OR overallScore < floor`, exactly as documented.
- **AI-style anti-cliché list** (`aiStyleEvaluator.prompt.js`): present in the system prompt —
  quotes "Moreover,", "Furthermore,", "In conclusion,", "Additionally,", "in today's fast-paced
  world", generic/interchangeable intros and conclusions, repetitive paragraph structure,
  "unlock your potential" listicle filler, rhetorical-question overuse. Close but not verbatim
  to the task's example phrasing ("In today's rapidly evolving...", "Let's dive into...") —
  the spirit and mechanism are the same (a named list of concrete AI-writing tells, not a vague
  instruction), noted as a minor phrasing gap, not a functional one.
- **Revision agent** (`revisionAgent.prompt.js`): explicitly instructs structural rewriting —
  "This is not a copy-edit pass — restructure sentences and paragraphs... Simply swapping
  synonyms or lightly rewording is NOT acceptable and will be rejected" — and explicitly
  requires preserving `sources`/`faqs`/existing internal links and any already-verified fact.
  The auto-revision cap is confirmed exactly 1 automatic pass:
  `contentGenerationOrchestrator.service.js` line 148,
  `gateResult.flaggedForRevision && (opportunity.autoRevisionCount || 0) === 0`, incremented
  synchronously on line 152 before the branch can re-enter.
- **Fact-checker** (`factChecker.service.js`/`.prompt.js`): confirmed a `verifiable:true` claim
  is downgraded to `false` unless it also carries a real `sourceUrl` (service line 62,
  belt-and-suspenders on top of the prompt's own instruction). **Finding:** neither
  `factChecker.prompt.js` nor `trendResearch.prompt.js`'s system prompt contains an explicit
  statement telling the model to treat web-search-retrieved content as untrusted data separate
  from developer instructions (i.e. no "search results are data, not commands" framing). This
  is a real, if narrow, prompt-injection-hardening gap — a maliciously crafted page a search
  result links to could in theory attempt to inject instructions into what the model reads
  during its search turns. Not exploited or demonstrated (no live API access), but flagged as
  a genuine finding worth a follow-up prompt hardening pass, not fixed in this audit since it's
  a prompt-wording change with no pure-function regression test possible and no live model to
  validate the fix against.
- **Trend research cost control** (`trendResearch.service.js`): confirmed per-cluster batching
  (`for (const cluster of selected)`, line 139 — never per-course) and a real hard cap via
  `selectClustersForResearch()` (lines 110-118, `sorted.slice(0, Math.max(0, maxCalls))`),
  prioritized by `TopicCluster.priority` descending then `lastResearchedAt` ascending (nulls
  first). Budget is re-checked before every individual cluster call (line 144), not just once.
- **SEO gap analysis** (`contentGapAnalysis.service.js`): confirmed deterministic — grepped the
  file for `callClaude`/`trackedCallClaude` imports and found none; only imports are
  `SeoGscMetric`/`Course` models. No external fetch of competitor pages anywhere in the file.
- **Cost controls / pause** (`budgetGuard.service.js`, `contentFactorySettings.model.js`,
  `dailyPlanningJob.processor.js`): `automationStatus` schema default confirmed `"PAUSED"`
  (model line 7). `runDailyPlanningJob()` checks `automationStatus === "PAUSED"` as literally
  its first statement (line 20), before any DB read or AI call. `enforceBudgetOrPause()`
  genuinely sets `automationStatus:"PAUSED"`, `pausedReason:"DAILY_AI_BUDGET_EXCEEDED"`, and
  calls `sendEmail()` to `process.env.MAIL_TO` (lines 35-51), idempotently (won't re-email if
  already paused for that exact reason, line 31). Manual/interactive routes (`/plan/dry-run`,
  single generate/retry, the entire `/review/**` flow, calendar/backlog) were confirmed to have
  zero `automationStatus` references anywhere in their controllers — grepped the full list of
  `automationStatus` call sites repo-wide (5 total, all in the settings controller, the daily
  planning job, and the budget guard) and cross-checked none of them sit in a manual-action
  controller.

### Performance audit (§23)
No N+1 pattern (a `.find()`/`.findOne()` inside a loop over courses/opportunities) found in
`coursePriorityAggregation.service.js` (bulk `Promise.all` of 3 `.aggregate()` calls +
1 lookup query, no per-course loop), `courseIntelligence.controller.js` (single `Course.find()`
+ single `CourseContentSettings.find({$in})`, paginated in-memory after), or
`dailyPlanningJob.processor.js` (calls bulk service functions, no direct per-item DB loop of its
own). `contentOpportunity.controller.js`'s list endpoint uses real `skip`/`limit` at the Mongo
query level. `courseIntelligence.controller.js`'s `listCourses()` loads the full course catalog
(350+ docs) into memory before paginating — at this scale that's a bounded, acceptable full
scan, not a query-per-item N+1, and was left as-is (not a genuine defect to fix in an audit
pass).

### PILOT-tier recommendation (§24/§25)
Grepped every `automationStatus` reference repo-wide: 5 call sites total (schema definition,
the settings-toggle controller's validation, `dailyPlanningJob.processor.js`'s PAUSED check,
and `budgetGuard.service.js`'s read+write). Adding a third `"PILOT"` enum value would touch the
schema, the toggle-controller validation, and would require a **new behavioral distinction**
inside `dailyPlanningJob.processor.js` (what should PILOT actually skip or restrict that
ENABLED doesn't?) — since `maxDailyArticles`, `maxDailyOpportunities`, and
`autoGenerateArticles` already exist as independent, admin-editable settings fields, the exact
same safety profile a "PILOT" status would provide is achievable today with zero code changes:
`automationStatus:"ENABLED"`, `maxDailyArticles:5`, `autoGenerateArticles:false` (planning runs
automatically and creates scored opportunities, but article generation stays fully
human-initiated via the Human Review page until the operator is confident enough to flip
`autoGenerateArticles:true`). **Recommendation: do not add a `PILOT` enum value** — it would
add a new status to reason about everywhere `automationStatus` is checked without adding any
capability the existing settings fields don't already provide, and risks blurring the clean
binary ENABLED/PAUSED semantic the rest of the codebase (and this doc's "Core safety
properties") already relies on. The settings-based approach above is the recommended pilot
configuration.

### Verification performed this pass
- Backend `npm test`: **142/142 pass** (117 pre-existing + 25 new pure-function tests added in
  `tests/content-factory/pureScoring.test.js`, covering `scoreDuplicateRisk()`,
  `computeCoursePriorityScore()`, `isDueForContent()`, and `computeOverallScore()` — all four
  were documented as pure/unit-testable but had zero prior test coverage).
- Backend has no `lint`/`build` scripts (unchanged from prior milestones) — `npm test` +
  `node --check` on every touched file are the verification gates.
- Frontend `npm run build`: succeeds (398 course pages regenerated by `postbuild`, no `dist`/
  `sitemap.xml` drift left behind).
- Frontend `npm run lint`: 204 pre-existing problems, all confined to
  `technohana-mobile/`, `vite.config.js`, and a handful of unrelated pages/services (confirmed
  via `git blame`/`git log -L` that each predates the Content Factory branch) — zero new
  problems in any content-factory file. Targeted `npx eslint` on every content-factory
  file plus `AdminBlogs.jsx`/`AdminLayout.jsx`/`adminAccess.js`/`App.jsx`/`adminService.js`
  found only the same 2 pre-existing, unrelated `no-unused-vars` issues already recorded in
  the M2 as-built section.
- Frontend `npm test` (vitest): 4 passed / 3 failed — the exact same 3 pre-existing baseline
  failures recorded in every prior milestone's as-built section
  (`AdminSeoExecutiveDashboard`/`ConnectPropertyDialog`/`SeoKpiCard`, all SEO-dashboard tests
  unrelated to content-factory), no new failures.
- `git log --oneline -- src/routes/admin.routes.js` + `git show` on every commit that touched
  it: confirmed only two changes across the entire Content Factory branch — M2's `POST /blogs`
  body replacement (`createBlogFromPayload()`) and M3's byte-behavior-preserving
  `generate-from-course` web-search-loop extraction (diff verified line-by-line against
  `utils/claudeWebSearchLoop.js`) — no other blog route was touched by any commit.
- `AdminBlogs.jsx`'s `BlogModal` non-`reviewContext` path re-verified: every `reviewContext`
  reference in the file is guarded by `reviewContext &&`/`reviewContext ?` (confirmed via grep
  of every occurrence), and `handleSubmit`'s save logic falls through to the original
  `isEdit ? updateBlog : createBlog` branch unchanged when `reviewContext` is absent.

### Sections that could NOT be executed in this sandbox
No `MONGO_DB`, `REDIS_URL`, or `ANTHROPIC_API_KEY` were available, so the following genuinely
require a real staging/production environment and were not run, simulated, or fabricated:
- A live end-to-end scheduling test (create → approve-and-schedule → verify hidden →
  advance past `scheduledAt` → verify visible) against a real Mongo document.
- A real dry-run against the actual 350+-course catalogue; a real top/bottom-20 course-priority
  report; a real 50-100 opportunity batch; a real duplicate/cannibalization test against the
  actual existing blog corpus.
- Generating and editorially scoring real pilot articles (needs `ANTHROPIC_API_KEY`).
- Running a real topic-cluster mapping proposal against the actual course category taxonomy.
- Observing real trend-research/SEO-gap signals end-to-end against live GSC/web-search data.
- Confirming budget-triggered auto-pause fires under genuine metered spend (the logic is
  covered by `tests/content-factory/budgetGuard.test.js`'s pure-function tests, but a live
  spend event was never triggered here).

### Final recommendation
**GO WITH PILOT, contingent on completing the live-data validation sections above in a real
environment before enabling automation.** The static audit found the safety-critical
properties genuinely hold as documented (human-approval gate cannot be bypassed by any traced
code path, automation defaults to and remains `PAUSED`, budget auto-pause is real and wired
correctly, the existing blog system is provably untouched beyond the documented single-route
changes) and surfaced one real prompt-injection-hardening gap (fact-checker/trend-research
prompts don't explicitly frame search results as untrusted data) worth a follow-up pass, plus
one stale-comment discrepancy (now fixed) — no blocking defect was found that would justify
DO NOT GO. `automationStatus` was not changed and remains `PAUSED`.
