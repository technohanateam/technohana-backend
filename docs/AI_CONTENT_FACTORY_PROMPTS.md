# AI Content Factory — Prompt Catalog

Reference of every prompt module under `src/prompts/contentFactory/`, one entry each.
"Model tier" is the `tier` passed to `trackedCallClaude()`/`callClaude()` by the service that
consumes the prompt — `"cheap"` → Haiku, `"standard"` → Sonnet (see
`aiAgent.service.js`/`aiUsageTracker.service.js`). Kept concise — see the source files for
full prompt text.

| Prompt module | Consumed by | Tier | Milestone |
|---|---|---|---|
| `topicClusterProposal.prompt.js` | `topicClusterMapping.service.js` | cheap | M1 |
| `opportunityCandidateWriter.prompt.js` | `contentStrategy.service.js` | standard | M1 |
| `duplicateAlternativeAngle.prompt.js` | *(not currently called — see note)* | n/a | M1 |
| `contentBrief.prompt.js` | `contentBriefWriter.service.js` | standard | M2 |
| `articleWriter.prompt.js` | `articleWriter.service.js` | standard | M2 |
| `seoFieldWriter.prompt.js` | `seoFieldWriter.service.js` | cheap | M2 |
| `internalLinker.prompt.js` | `internalLinker.service.js` | cheap | M2 |
| `imagePromptWriter.prompt.js` | `imagePromptWriter.service.js` | cheap | M2 |
| `factChecker.prompt.js` | `factChecker.service.js` | standard (web-search loop) | M3 |
| `aiStyleEvaluator.prompt.js` | `aiStyleEvaluator.service.js` | cheap | M3 |
| `qualityEvaluator.prompt.js` | `qualityGate.service.js` | standard | M3 |
| `revisionAgent.prompt.js` | `revisionAgent.service.js` | standard | M3 |
| `trendResearch.prompt.js` | `trendResearch.service.js` | standard (web-search loop) | M5 |

`contentGapAnalysis.prompt.js` does not exist — Milestone 5's gap analysis is purely
deterministic (no Claude call). See `AI_CONTENT_FACTORY_IMPLEMENTATION.md`
"As-built — Milestone 5" for why.

---

### `topicClusterProposal.prompt.js`
**Responsibility:** propose a topic-cluster mapping from the real distinct course category
list — one batched call, never auto-applied (admin must confirm via `apply-mapping`).
**Input:** `{ categories: string[] }` (all distinct `Course.category` values).
**Output contract:** `{ clusters: [{ name, slug, description, categories: string[], priority }] }`.

### `opportunityCandidateWriter.prompt.js`
**Responsibility:** for each surviving-dedup planning candidate (course + content type
pairing), write the creative/strategic fields (title, keywords, angle, scores). ONE batched
call per planning run covering all candidates.
**Input:** `{ candidates: [{courseTitle, category, contentType, clusterName, priorityTier}] }`.
**Output contract:** `{ opportunities: [{title, focusKeyword, secondaryKeywords, searchIntent, businessIntentScore, courseRelevanceScore, targetAudience, topicAngle, recommendationReason}] }` — exactly one entry per input candidate, same order.

### `duplicateAlternativeAngle.prompt.js`
**Responsibility:** built (M1) to suggest an alternative angle when a candidate title
conflicts with existing content, but is not wired into any current call site — no service
imports it as of Milestone 5. Left in place for a future "suggest alternative instead of
just rejecting" duplicate-handling feature.
**Input:** `{ candidateTitle, conflictingTitles: string[] }`.
**Output contract:** not enforced anywhere currently (module only exports prompt builders).

### `contentBrief.prompt.js`
**Responsibility:** expand an approved `ContentOpportunity` into a full writing brief
(headings, angle, internal-link candidates) before the article is drafted.
**Input:** `opportunity` (full `ContentOpportunity` doc/plain object).
**Output contract:** `{ headings: [{level, text}], ..., suggestedInternalLinks: {courses:[{courseSlug,reason}], blogs:[{blogId,reason}]} }` (see `contentBrief.model.js` for the full field set the brief is validated against).

### `articleWriter.prompt.js`
**Responsibility:** write the full article — extracted copy of `generate-from-course`'s
prompt+web-search logic, parameterized on a brief instead of a raw course. Uses the
web-search loop for currency/accuracy.
**Input:** `{ brief, opportunity, relatedCoursesBullets }`.
**Output contract:** `{title, slug, excerpt, content, metaTitle, metaDescription, focusKeyword, tags, readTimeMin, author, category, sources, faqs}` — mirrors `Blogs` schema fields 1:1.

### `seoFieldWriter.prompt.js`
**Responsibility:** SEO metadata pass — meta title/description within the existing 50-60/140-160 char thresholds, focus keyword, tags.
**Input:** `{ articleDraft, brief }`.
**Output contract:** `{metaTitle, metaDescription, focusKeyword, tags}`.

### `internalLinker.prompt.js`
**Responsibility:** propose 2-5 course links + 1-4 blog links from a real candidate pool
(validated against actual slugs by the service, not trusted blindly from the model).
**Input:** `{ articleDraft, candidateCourses, candidateBlogs }`.
**Output contract:** `{courses:[{courseSlug,anchorText,reason}], blogs:[{blogId,anchorText,reason}]}`.

### `imagePromptWriter.prompt.js`
**Responsibility:** image concept only — prompt/alt-text/filename, never a real image call.
Always lands `imageConcept.status: "IMAGE_PENDING"`, `tier: "AI_PROMPT_ONLY"`.
**Input:** `{ articleDraft, opportunity }`.
**Output contract:** `{prompt, altText, suggestedFilename}`.

### `factChecker.prompt.js`
**Responsibility:** search-grounded verification of factual/current claims in a finished
draft. Never marks a claim `verifiable:true` without an actual `sourceUrl` found via search;
unverifiable claims are kept with `verifiable:false` and a note rather than dropped or faked.
**Input:** `{ articleDraft }`.
**Output contract:** `{findings:[{claim, verifiable, note, sourceUrl}]}`.

### `aiStyleEvaluator.prompt.js`
**Responsibility:** score how "AI-generated-sounding" the article reads (0-100 risk), with
reasons — feeds the quality gate's `aiStyleRiskThreshold` check.
**Input:** `{ articleContent }`.
**Output contract:** `{aiStyleRiskScore, flagReasons: string[]}`.

### `qualityEvaluator.prompt.js`
**Responsibility:** score the remaining composite-quality dimensions not covered by the
fact-checker/AI-style calls (originality, readability, relevance, intent alignment, CTA
relevance, specificity, original insight, editorial quality).
**Input:** `{ articleDraft, brief, opportunity }`.
**Output contract:** `{originalityScore, readabilityScore, courseRelevanceScore, searchIntentAlignmentScore, ctaRelevanceScore, specificityScore, originalInsightScore, editorialQualityScore}` (each 0-100) — combined with fact-check/AI-style/SEO/internal-link scores by `qualityGate.service.js`'s pure `computeQualityGateResult()`.

### `revisionAgent.prompt.js`
**Responsibility:** genuine rewrite of flagged sections only — must preserve sources/links/facts, never invent new claims. Capped at one automatic pass by the orchestrator before routing to human review with flag history attached.
**Input:** `{ articleDraft, flagReasons, factCheckFindings, brief, humanNote, stronger }`.
**Output contract:** same shape as the input draft — `{title, slug, content, excerpt, metaTitle, metaDescription, tags, readTimeMin, sources, faqs, focusKeyword, author, category}`.

### `trendResearch.prompt.js`
**Responsibility:** search-grounded discovery of genuinely current trends/news for ONE topic
cluster (batched per-cluster, never per-course). Never states a trend without having
searched for it; never includes a trend with a fabricated/guessed `sourceUrl` — omits it
entirely instead.
**Input:** `{ cluster }` (name, description, categories).
**Output contract:** `{trends:[{topic, summary, sourceUrls: string[]}]}` — the consuming service (`trendResearch.service.js`) additionally drops any trend whose `sourceUrls` came back empty, and appends `cluster`/`clusterId`/`matchedCourses` itself (not part of the model's own JSON contract).
