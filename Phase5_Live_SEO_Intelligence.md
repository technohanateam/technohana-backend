# Phase 5 — Live SEO Intelligence Platform

Extends the Phase 1–4 SEO Ops admin module with live Google Search Console
and GA4 data, a technical SEO crawler, an executive dashboard, and a
rule-based recommendations/alerts engine. Nothing in Phase 1–4 was modified.

## Architecture

```
┌─────────────────────┐      ┌───────────────────────────────────────┐
│  Admin frontend      │      │  technohana-backend                    │
│  /admin/seo-intel/*  │◄────►│  /admin/seo-intel/*  (seoIntel.routes) │
└─────────────────────┘      │                                         │
                              │  ┌─────────────┐  ┌───────────────┐    │
                              │  │ gscSyncQueue│  │ ga4SyncQueue  │    │
                              │  └──────┬──────┘  └──────┬────────┘    │
                              │         │                │             │
                              │  ┌──────▼────────────────▼──────┐      │
                              │  │  Google Search Console API    │      │
                              │  │  GA4 Data API (reporting)     │      │
                              │  └───────────────────────────────┘      │
                              │                                         │
                              │  ┌─────────────┐                        │
                              │  │ crawlQueue   │──► seoCrawler.js      │
                              │  └─────────────┘     (axios + cheerio)  │
                              │                                         │
                              │  recommendationEngine.js / seoAlertService.js │
                              └─────────────────────────────────────────┘
```

All background jobs run on Bull (Redis-backed), the same queue library
already used for campaign emails (`src/services/campaignQueue.js`).

## OAuth Flow

A dedicated Google Cloud OAuth client (separate from the existing end-user
login client in `src/config/passport.js`) is used, scoped to
`webmasters.readonly` + `analytics.readonly`. Env vars:

```
SEO_GOOGLE_CLIENT_ID=
SEO_GOOGLE_CLIENT_SECRET=
SEO_GOOGLE_REDIRECT_URI=   # e.g. https://api.technohana.in/admin/seo-intel/oauth/callback
```

1. `POST /admin/seo-intel/connect/:provider` (admin-authenticated) builds a
   consent URL with a signed, short-lived `state` JWT and returns it to the
   frontend, which navigates the browser to it.
2. Google redirects back to `GET /admin/seo-intel/oauth/callback` — a
   **public** route (added to `noOriginRequiredPaths` in `src/index.js`
   since the browser redirect carries no Origin header). The route
   validates `state`, exchanges the auth code for tokens, and for GSC lists
   all verified properties (`sites.list`) and stores one `SeoConnection`
   per property. For GA4 (no "list my properties" call exists with
   `analytics.readonly` alone) a pending connection is stored and the admin
   enters the numeric property ID via `PATCH
   /admin/seo-intel/connections/:id/ga4-property`, which verifies access
   with a live `runReport` call before activating.
3. Refresh tokens are encrypted with the existing `src/utils/tokenCrypto.js`
   (AES-256-GCM + PBKDF2, keyed off `ENROLLMENT_TOKEN_KEY`) before storage.
   Access tokens are never stored — `googleapis`' OAuth2 client refreshes
   them on demand from the stored refresh token.
4. `DELETE /admin/seo-intel/connections/:id` best-effort revokes the token
   and deletes the connection.

## Collections

All new, none of the Phase 1–4 SEO Ops collections were touched.

| Model | Purpose | History policy |
|---|---|---|
| `SeoConnection` | OAuth-connected GSC/GA4 properties | current state (upsert) |
| `SeoGscMetric` | Daily GSC metrics by query/page/country/device/date | append-only (idempotent per day) |
| `SeoGscSitemap` | Sitemap status | current state (upsert) |
| `SeoGa4Metric` | Daily GA4 metrics by landing page/event/traffic source/device/country | append-only (idempotent per day) |
| `SeoCrawlRun` | One doc per crawl execution + issue summary | append-only |
| `SeoCrawlPage` | One doc per URL per crawl run | append-only per run |
| `SeoRecommendation` | Rule-generated recommendations | mutable status, deduped per (rule, URL, open) |
| `SeoAlert` | Threshold-breach alerts | append-only |
| `SeoAuditLog` | Connect/disconnect/settings/dismiss actions | append-only, 180-day TTL |
| `SeoIntelligenceSettings` | Crawl base URL, thresholds, alert recipients | singleton |

## API Endpoints

All under `/admin/seo-intel`, guarded by `authenticateAdmin` +
`requirePage(...)` + `requireMarketing` for writes (mirrors
`seoOps.routes.js`). Only `GET /oauth/callback` is public.

- `GET /connections`, `POST /connect/:provider`, `PATCH
  /connections/:id/ga4-property`, `DELETE /connections/:id`
- `GET /gsc/{summary,queries,pages,countries,devices,sitemaps}`, `POST
  /gsc/inspect-url`, `POST /sync/gsc`
- `GET /ga4/{summary,landing-pages,events,traffic-sources}`, `POST
  /sync/ga4`
- `GET /crawl/runs`, `GET /crawl/runs/:id`, `GET
  /crawl/runs/:id/pages`, `POST /crawl/trigger`
- `GET /executive/dashboard`, `GET /executive/health-score`
- `GET /recommendations`, `PATCH /recommendations/:id`
- `GET /alerts`, `PATCH /alerts/:id/acknowledge`
- `GET /settings`, `PATCH /settings`

## Background Jobs / Scheduler

`src/services/seoIntelQueue.js` — five Bull queues, scheduled via Bull's
native `repeat: { cron }` (Bull dedupes repeatables by cron+data, so
`scheduleSeoIntelRepeatables()` is called unconditionally on every server
boot, right after `connectDb()`):

| Queue | Schedule | Does |
|---|---|---|
| `gscSyncQueue` | daily 3am | Sync all active GSC connections, regenerate GSC recommendations, check traffic-drop alerts |
| `ga4SyncQueue` | daily 3am | Sync all active GA4 connections, regenerate GA4 recommendations, check traffic-drop alerts |
| `crawlQueue` | weekly Mon 4am | Crawl the configured base URL, regenerate crawl recommendations, check crawl-regression alerts |
| `execReportQueue` | weekly Mon 8am | Email a summary to `alertEmailRecipients` |
| `scoreRecalcQueue` | monthly 1st 5am | Reserved for future rolling health-score recalculation (health score is currently computed on-demand from the latest crawl) |

Each queue also has a manual-trigger endpoint (`POST /sync/gsc`, `POST
/sync/ga4`, `POST /crawl/trigger`) for "Sync Now" buttons in the UI.

## Security

- OAuth refresh tokens are AES-256-GCM encrypted at rest, never returned by
  any API response.
- OAuth callback validates a signed, 10-minute-expiry `state` token instead
  of trusting the redirect.
- All read/write endpoints require `authenticateAdmin` + page-level
  permission (`requirePage`); writes additionally require
  `requireMarketing`.
- API failures are logged (`console.error`) and surfaced via
  `SeoConnection.lastSyncStatus`/`lastSyncError` rather than crashing sync
  jobs; a failed connection auto-retries on the next scheduled sync.
- Every connect/disconnect/settings-change/recommendation-status-change/
  manual-sync action is recorded in `SeoAuditLog`.

## Performance

- Crawl BFS is concurrency-bounded (default 5, admin-configurable) with a
  page cap (default 500, admin-configurable) and dedupes broken-link HEAD
  checks across the whole run.
- All time-series queries use compound Mongo indexes on
  `(propertyId, dimensionType, date)`.
- The executive dashboard reads only already-synced Mongo data — it never
  makes a live Google API call on page load.

## Known Limitations

- **Never fabricated**: authority scores, backlink counts, and competitor
  metrics are not implemented in this phase — the spec explicitly forbids
  fabricating them, and no verified data source for them is connected yet.
  Any UI surface for these remains out of scope until a real provider
  (e.g. Ahrefs/Semrush API) is connected.
- GA4 property connection requires the admin to manually enter the numeric
  property ID after OAuth consent — the Data API has no "list my
  properties" call under `analytics.readonly` scope alone.
- URL Inspection (`gsc/inspect-url`) is rate-limited by Google to ~2,000
  requests/day per property and is therefore exposed as an on-demand,
  single-URL action, not run in bulk.
- `scoreRecalcQueue` is currently a no-op placeholder; the health score is
  computed on-demand from the latest crawl in `getExecutiveDashboard` /
  `getHealthScore`.
- Backend tests (`npm test`, Node's built-in test runner) cover pure logic
  only (crawler issue detection, recommendation rule shape) — no live
  Google API calls or database integration tests are included, since no
  test database is available in this environment.

## Future Work

- Rolling/weighted health-score recalculation in `scoreRecalcQueue`.
- Competitor and backlink dashboards once a verified third-party data
  source is connected.
- Orphan-page and internal-linking depth analysis (link graph across
  crawl runs, not just per-page counts).
- Push-based GSC/GA4 webhooks instead of polling sync, if/when Google
  exposes them for these APIs.
