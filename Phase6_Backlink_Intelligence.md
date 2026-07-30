# Phase 6 — AI Backlink Intelligence & Outreach Platform

Extends the Phase 1–4 SEO Ops admin module (Opportunities, Competitors,
Outreach CRM, Monitoring, Reports) with AI-assisted discovery, AI-drafted
outreach, automated link verification, competitor CSV gap analysis, and
backlink-specific recommendations. Phase 5 (Live SEO Intelligence — GSC/GA4/
crawler) was not touched.

**Everything here extends the existing SEO Ops models and pages — there are
no new collections and no new top-level admin section.** The task spec's
"new collections" (`seoBacklinkOpportunity`, `seoBacklinkOutreach`, etc.) map
onto the existing `SeoOpportunity`/`SeoContact`/`SeoMonitoring` models with
additive fields instead, avoiding a second, divergent backlink system in the
admin panel.

No automatic backlink creation is implemented anywhere — discovery only ever
proposes and scores candidates, outreach emails are drafted and require a
human "Send" click, and monitoring only ever *observes* link state.

## Architecture

```
┌─────────────────────┐      ┌────────────────────────────────────────────┐
│  Admin frontend      │      │  technohana-backend                        │
│  /admin/seo/*        │◄────►│  /admin/seo/*  (seoOps.routes.js)          │
└─────────────────────┘      │                                             │
                              │  ┌──────────────────┐  ┌──────────────────┐│
                              │  │ backlinkDiscovery │  │ backlinkVerify   ││
                              │  │ Queue (weekly)     │  │ Queue (weekly)   ││
                              │  └────────┬──────────┘  └────────┬─────────┘│
                              │           │                       │         │
                              │  ┌────────▼──────────┐  ┌─────────▼───────┐│
                              │  │ backlinkDiscovery  │  │ backlinkVerify  ││
                              │  │ Service.js         │  │ Service.js      ││
                              │  │ (Claude + fetch)   │  │ (fetch + diff)  ││
                              │  └────────────────────┘  └─────────────────┘│
                              │                                             │
                              │  ┌──────────────────────────────────────┐  │
                              │  │ robotsCache.js / domainRateLimiter.js │  │
                              │  │  (shared by both services above)      │  │
                              │  └──────────────────────────────────────┘  │
                              │                                             │
                              │  backlinkOutreachAiService.js (Claude)      │
                              │  backlinkCompetitorGapService.js (CSV)      │
                              │  recommendationEngine.js (+ backlink rules) │
                              │  backlinkRecommendationQueue (daily)        │
                              └─────────────────────────────────────────────┘
```

All background jobs run on Bull (Redis-backed), the same queue library
already used for Phase 5 (`src/services/seoIntelQueue.js`) and campaign
emails (`src/services/campaignQueue.js`).

## Database — schema extensions (no new collections)

| Model | New fields | Purpose |
|---|---|---|
| `SeoOpportunity` | `contactPageUrl`, `contactEmail`, `anchorTextSuggestion`, `discoveryConfidenceScore`, `discoverySource` (`ai-seed`/`manual`/`csv-import`/`competitor-gap-scan`), `lastVerifiedAt`, `robotsAllowed`, `discoveryRawNotes`, `trafficPotential`, `competitionLevel` | AI discovery evidence + new scoring factor inputs |
| `SeoContact` | `opportunityId` (ref), `aiDrafts[]` (subject/body/reason/suggested page+anchor/2 follow-ups/status/sentAt/sentBy), extended `status` enum (`email-sent`/`opened`/`negotiating`/`accepted`/`live-link`/`lost-link`, additive to the existing 7 values) | AI outreach drafts + finer CRM stages |
| `SeoMonitoring` | `opportunityId` (ref), `dofollow`, `httpStatus`, `redirectedTo`, `anchorTextObserved`, `anchorTextChanged`, `verificationMethod`, `lastVerificationError`, `consecutiveFailedChecks` | Automated verification state |
| `SeoRecommendation` | `category` enum gains `"backlink"` | Backlink-specific rule recommendations |
| `SeoAlert` | `type` enum gains `backlink_lost`/`backlink_anchor_changed`/`backlink_nofollow_changed`/`backlink_redirect_detected` | Monitoring alerts |
| `SeoSettings` | 8-factor `scoringWeights` (relevance/authority/trafficPotential/editorialQuality/acceptanceProbability/partnershipPotential/competition/freshness, summing to 100), `backlinkVerification` (rateLimitMs/userAgent/requestTimeoutMs/maxRedirects), `discovery` (candidatesPerRun/categoriesSeedList) | Admin-configurable scoring + automation |

All additions are additive and optional — no backfill script is required.
One required one-time action after deploy: re-run `POST
/admin/seo/scripts/score` so existing `competitor-gap` opportunities get
scored under the new 8-factor formula.

## Scoring engine (Module 2)

`src/services/seoOpsScripts.service.js` exports `computeOpportunityScore(doc,
weights, currentYear)` — a pure function (no DB access, directly unit
tested) implementing the 8 named factors from the spec:

- **Relevance** — mapped from `potentialForTechnohana`.
- **Authority** — parsed from `estimatedAuthority` (flags `authorityUnscored`
  rather than fabricating a number when it's not numeric).
- **Traffic Potential** — mapped from the new `trafficPotential` field.
- **Editorial Quality** — mapped from `evidenceLevel`.
- **Acceptance Probability** — mapped from `priority`.
- **Partnership Potential** — keyword-scored from `opportunityType`
  (partnership/vendor/association/chapter scores highest).
- **Competition** — mapped from the new `competitionLevel` field, inverted
  (lower competition scores higher).
- **Freshness** — decayed from `contentYear`.

`recomputeOpportunityScores()` reads `SeoSettings.scoringWeights` (falling
back to sane defaults) — this closes a pre-existing gap where the admin
Settings page's scoring weights were stored but never actually read by the
scoring function.

## Module 1 — AI-seeded discovery

`src/services/backlinkDiscoveryService.js`:

1. `proposeDiscoveryCandidates({category, count})` asks Claude (the shared
   `callClaude()`/`extractJson()` client in `aiAgent.service.js`) to propose
   real, well-known websites per category — directories, resource pages,
   associations, guest-post blogs. The system prompt explicitly forbids
   inventing placeholder domains.
2. `fetchAndScoreCandidate(...)` — for each proposed domain: checks
   `robots.txt` (`robotsCache.js`), then fetches only the homepage and a
   fixed list of guessed contact-page paths (`/contact`, `/contact-us`,
   `/about`, `/about-us`) — **never** follows links found on those pages —
   extracts a contact email (mailto: link or a bare-email regex fallback),
   and upserts a `SeoOpportunity` (deduped by `sourceKey:
   ai-seed:<domain>:<category>`).
3. `runDiscoveryBatch({categories, triggeredBy})` orchestrates the above per
   category and logs a `SeoAuditLog` entry.

Triggered weekly (Monday 6am) via `backlinkDiscoveryQueue`, or on demand via
`POST /admin/seo/discovery/run` (the "Run AI Discovery" dialog on the
Opportunities page).

## Module 2 — see "Scoring engine" above.

## Module 3 — AI Outreach Assistant

`src/services/backlinkOutreachAiService.js` → `generateOutreachDraft({contactId})`
pulls the contact's linked `SeoOpportunity` for context (target page, anchor
suggestion, rationale) and asks Claude for `{subject, personalizedEmail,
reasonForOutreach, suggestedPage, suggestedAnchorText, followUp1,
followUp2}`, pushed into `SeoContact.aiDrafts[]` with `status: "draft"`.

**This function never calls `sendEmail()`.** The only place an outreach
email is actually sent is `POST
/admin/seo/outreach/contacts/:id/ai-draft/:draftIndex/send`, triggered by an
explicit "Send" click in the `AiDraftDialog` UI — everywhere else only
creates, edits, or discards a draft.

## Module 4 — Outreach CRM

`SeoContact.status` gained six new values, additive to the existing seven
(`new`/`contacted`/`follow-up`/`responded`/`published`/`declined`/`archived`)
— no data migration, no remap. The existing `nextFollowUp` field doubles as
the "reminder date." `opportunityId` links a contact back to the opportunity
it was generated from (used by both the AI drafting service and by
verification's lost-link handling below).

## Module 5 — Backlink Monitoring

`src/services/backlinkVerificationService.js` → `verifyMonitoringRecord(record)`:

1. Checks `robots.txt` for the monitored `liveUrl`; skips the fetch entirely
   (recording `lastVerificationError: "Blocked by robots.txt"`) if disallowed.
2. Rate-limited fetch (`domainRateLimiter.js`) of the single known `liveUrl`,
   following redirects up to a configurable cap.
3. Parses the response HTML (cheerio) for the first `<a>` matching the
   recorded `targetPage` (host+path match, tolerant of a trailing slash),
   reading its visible text and `rel` attribute.
4. Diffs the observed state against what's stored: link missing → `lost`;
   HTTP ≥400 → `broken`; anchor text changed → `anchorTextChanged`; `rel`
   gained `nofollow` → dofollow flip; final URL differs from `liveUrl` →
   redirect detected.
5. Creates a `SeoAlert` **only on a genuine state transition** — re-running
   against unchanged state never creates a duplicate (a 24h cooldown check
   against existing unacknowledged alerts of the same type+URL prevents
   duplicate alerts even across back-to-back runs). Sends an internal
   notification email (`generateBacklinkAlertEmail`) to
   `SeoIntelligenceSettings.alertEmailRecipients` when an alert fires.
6. On loss, flips any linked `SeoContact.status` to `lost-link` so it
   surfaces as needing re-outreach (see Module 7).

Triggered weekly (Monday 7am) via `backlinkVerificationQueue`, or on demand
via `POST /admin/seo/monitoring/verify` (the "Run Verification Now" button).

## Module 6 — Competitor Backlink Discovery

`src/services/backlinkCompetitorGapService.js` → `importCompetitorBacklinkCsv({rows, competitorName})`
takes a manually-uploaded competitor backlink CSV (parsed client-side by the
existing `csv.js` utility), normalizes each `referringDomain`, and
cross-references it against domains already present in `SeoMonitoring` with
`linkStatus` `live`/`published`. Only the genuine gaps — domains linking to
the competitor but **not** to Technohana — are upserted as `SeoOpportunity`
records with `recordType: "competitor-gap"`, deduped by `sourceKey`.

## Module 7 — AI Recommendations

`src/services/recommendationEngine.js` gained `generateRecommendationsFromBacklinks()`,
reusing the file's existing `upsertRecommendation()` dedup helper and a new
`"backlink"` `SeoRecommendation` category. Four rules:

| Rule code | Fires when |
|---|---|
| `HIGH_VALUE_UNCONTACTED_OPPORTUNITY` | A `priority-opportunity` scores ≥ the admin-configured high threshold, is still `status: "new"`, and was created more than 3 days ago |
| `STALLED_OUTREACH_NO_FOLLOWUP` | A contact is `contacted`/`email-sent`, its `nextFollowUp` date has passed, and no follow-up has been logged as completed |
| `LOST_LINK_NEEDS_REOUTREACH` | A monitoring record is `linkStatus: "lost"` and there's no active (non-declined/archived/lost-link) contact already re-engaging that opportunity |
| `COMPETITOR_GAP_HIGH_SCORE` | A `competitor-gap` opportunity scores ≥ the high threshold and is still `status: "new"` |

Runs daily (5am) via `backlinkRecommendationQueue`. The existing
`AdminSeoRecommendations.jsx` admin page renders any category generically —
no frontend change was needed for this module.

## Module 8 — Dashboard / Analytics

`GET /admin/seo/analytics` (new `seo-ops-analytics` page,
`AdminSeoOpsAnalytics.jsx`) is a trend-oriented view distinct from the
existing current-state Dashboard snapshot: Total Opportunities, High
Priority, Outreach Sent, Response Rate, Live Links, Lost Links, New Links
This Month, and Average Opportunity Score, plus weekly time series for
opportunities created, the outreach funnel by status, and links updated by
status.

## Module 9 — Reports

Markdown generation (`generateMonthlyReport()`) already existed; this phase
adds PDF (`pdfkit`, already a dependency) and CSV export endpoints
(`GET /admin/seo/reports/:id/download.pdf` / `.csv`) alongside the existing
Markdown download, following the same blob-download pattern used by
`downloadSeoReport` on the frontend. CSV export parses the `| Metric | Value
|` markdown table rows already written by `generateMonthlyReport()`.

## Module 10 — Background Jobs

`src/services/backlinkQueue.js` mirrors the Phase 5 `seoIntelQueue.js`
pattern exactly (same `QUEUE_SETTINGS`, imports — rather than redefines —
`SYNC_RETRY_CONFIG`/`SINGLE_RUN_RETRY_CONFIG`):

| Queue | Schedule | Does |
|---|---|---|
| `backlinkDiscoveryQueue` | weekly, Monday 6am | AI-seeded discovery across the configured category list |
| `backlinkVerificationQueue` | weekly, Monday 7am | Verifies all stale/live monitoring records |
| `backlinkRecommendationQueue` | daily 5am | Regenerates backlink recommendations |

`scheduleBacklinkRepeatables()` is called unconditionally on every server
boot (in `src/index.js`, right after the existing Phase 5 registration) —
Bull dedupes repeatables by cron+data, so this is safe across redeploys.
Each queue also has an on-demand endpoint for its "Run Now" UI button.

## Module 11 — Database (see "Database" section above)

## Module 12 — Permissions

Roles: **Marketing** (existing — already has full write access to every
`seo-ops-*` page), **Admin/Super Admin** (existing — full access to
everything), **Read-only Analyst** (new):

- Added `"analyst"` to the legacy admin-panel `role` enum
  (`AdminUser.model.js`), `ADMIN_ROLES`, and `LEGACY_ROLES`.
- `DEFAULT_PAGES_BY_ROLE.analyst` grants view access to every `seo-ops-*`
  page except Settings, and none of the `seo-intel-*` pages (mirrored in the
  frontend's `adminAccess.js`).
- **The one change requiring care**: `authenticateAdmin.js`'s admin-panel
  gate previously allowlisted exactly `role === "admin"`; it now checks
  `ADMIN_PANEL_ROLES = ["admin", "analyst"]`. No change was needed to
  `requireAdmin`, `requireMarketing`, or `CRM_ONLY_ROLES` — `analyst`
  matches neither the admin nor marketing allowlist, so every existing
  write route (`requireMarketing`-gated) already 403s an analyst account
  automatically, with no new middleware. A dedicated regression test suite
  (`tests/backlink/authenticateAdmin.analyst.test.js`) confirms analyst can
  read but not write, and that `sales`/CRM-only roles remain fully blocked
  from `/admin/*` exactly as before this change.
- Frontend `canWriteSeoOps(role)` hides (rather than just 403s) write
  buttons — New/Edit/Archive/Import/Run Discovery/Run Verification/AI
  Draft — across the Opportunities, Outreach, Competitors, and Monitoring
  pages for analyst accounts, purely for UX.

## API Endpoints (new, all under `/admin/seo`)

```
POST   /discovery/run                                  requirePage(seo-ops-opportunities), requireMarketing
GET    /discovery/status/:jobId                         requirePage(seo-ops-opportunities)
POST   /outreach/contacts/:id/ai-draft                  requirePage(seo-ops-outreach), requireMarketing
POST   /outreach/contacts/:id/ai-draft/:draftIndex/send requirePage(seo-ops-outreach), requireMarketing — the only route that sends an outreach email
PATCH  /outreach/contacts/:id/ai-draft/:draftIndex/discard requirePage(seo-ops-outreach), requireMarketing
POST   /monitoring/verify                               requirePage(seo-ops-monitoring), requireMarketing
GET    /monitoring/verify/status/:jobId                 requirePage(seo-ops-monitoring)
POST   /competitors/import                              requirePage(seo-ops-competitors), requireMarketing
GET    /analytics                                       requirePage(seo-ops-analytics)
GET    /reports/:id/download.pdf                        requirePage(seo-ops-reports)
GET    /reports/:id/download.csv                        requirePage(seo-ops-reports)
```

## Admin Pages

- **Opportunities** — "Run AI Discovery" dialog, discovery-source column/filter.
- **Outreach CRM** — "AI Draft" action per contact opening the review dialog
  (generate/send/discard), new status pill colors for the six additive stages.
- **Competitors** — "Import Competitor CSV" dialog.
- **Monitoring** — "Run Verification Now" button, dofollow/HTTP status/
  anchor-changed columns.
- **Reports** — PDF/CSV download buttons alongside the existing Markdown one.
- **Analytics** (new) — trend charts + KPI cards, `seo-ops-analytics` page key.
- **Team** — "analyst" is now a selectable role when creating an admin-panel account.

## Workflow (end to end)

1. Weekly discovery proposes candidates, fetches contact info, scores them.
2. A marketing user reviews new `SeoOpportunity` records, assigns an owner,
   creates a `SeoContact` linked to the opportunity.
3. Marketing clicks "AI Draft" — reviews the generated email — clicks "Send"
   only when satisfied. The contact moves to `email-sent`.
4. If a live link results, it's tracked in `SeoMonitoring`, linked back to
   the opportunity.
5. Weekly verification checks every live link; a loss or change raises an
   alert and, on loss, flips the contact to `lost-link`.
6. Daily recommendations surface stalled outreach, lost links needing
   re-engagement, and high-value opportunities/gaps still sitting untouched.
7. Monthly report + Analytics page summarize the funnel; PDF/CSV export for
   sharing outside the admin panel.

## Security / Respectful Automation

- Every outbound fetch (discovery and verification) checks `robots.txt`
  first via `robotsCache.js` (24h TTL cache, default-allow only when
  robots.txt itself is unreachable — never used as an excuse to skip a
  real disallow rule).
- A custom, identifiable User-Agent
  (`TechnohanaBacklinkBot/1.0 (+https://technohana.com/bot)`, admin-configurable)
  is sent on every request, including the robots.txt fetch itself.
- Per-domain rate limiting (`domainRateLimiter.js`, in-memory — no Redis
  needed for a single-instance deployment) enforces a minimum interval
  between requests to the same host.
- Discovery only ever fetches robots.txt, the homepage, and a fixed list of
  guessed contact-page paths — never follows arbitrary links found on those
  pages. Verification only ever fetches the one known `liveUrl` per record
  plus its redirect chain (capped).
- Outreach emails are drafted, never auto-sent — a human must explicitly
  click "Send" for any email to leave the system.
- Every discovery run, verification run, AI draft generation/send, and
  competitor import is recorded in `SeoAuditLog`.

## Known Limitations

- Discovery's AI-proposed candidates reflect Claude's training-time
  knowledge — they are unverified guesses until the fetch step confirms
  reachability and extracts real contact info; some proposed domains may be
  stale or no longer relevant.
- Contact-page discovery is a fixed path list (`/contact`, `/contact-us`,
  `/about`, `/about-us`), not a crawler — sites with contact info elsewhere
  won't yield an email automatically and fall back to `confidence: "Low"`.
- The robots.txt/rate-limit state is in-memory and per-process — fine for
  the current single-instance Railway deployment, but would need a
  Redis-backed store if the backend is ever horizontally scaled.
- PDF/CSV report export only works for reports with generated `content`
  (created via `generateMonthlyReport()`); pre-existing filesystem-based
  weekly reports (dev-only, no `content` field) don't support PDF/CSV export.
- Backend tests (`npm test`, Node's built-in test runner) cover pure logic
  and mocked-DB/mocked-network paths only — no live Claude API calls, no
  live outbound fetches, and no real MongoDB integration tests, matching
  the existing Phase 5 testing approach in this environment.

## Migration Notes

- All schema changes are additive; no migration script is required.
- **Required one-time post-deploy action**: run `POST
  /admin/seo/scripts/score` once so existing `competitor-gap` opportunities
  are rescored under the new 8-factor formula (otherwise they keep their
  old 7-factor score until the next scheduled recompute).
- Add `robots-parser` to `package.json` (already done) — no other new
  runtime dependencies were required (`cheerio`, `axios`, `pdfkit` already
  present).
- No `analyst` accounts exist until an admin creates one via the Team page;
  nothing changes for existing `admin`/`sales` accounts.
