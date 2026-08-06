# MCP Tool Reference

47 tools, grouped by area. **Role** is the minimum RBAC tier required to invoke the tool (see `src/config/roles.ts`) — roles are hierarchical: `admin` > `advertiser` > `analyst` > `viewer`, so a higher role can always call a lower tier's tools too. Every mutating tool (anything that creates/updates/deletes a Meta resource) writes an audit log entry (`src/middleware/auditLogger.ts`).

Every tool accepts an optional `connectionKey` argument identifying which stored Meta connection to use (a Business Manager ID from `list_businesses`, or `'personal'` if you have no Business Manager). Omit it when exactly one Meta account is connected — it resolves automatically. See [README.md](../README.md#connecting-a-meta-account) for how connections are established.

## Accounts & Businesses

| Tool | Role | Description |
|---|---|---|
| `list_ad_accounts` | viewer | Lists Meta (Facebook/Instagram) ad accounts visible to the connected account, optionally scoped to one Business Manager. |
| `list_businesses` | viewer | Lists Meta Business Manager accounts visible to the connected account. |

## Campaigns

| Tool | Role | Description |
|---|---|---|
| `list_campaigns` | viewer | Lists campaigns in a Meta ad account. |
| `create_campaign` | advertiser | Creates a new Meta ad campaign. Defaults to PAUSED status for safety. |
| `duplicate_campaign` | advertiser | Duplicates an existing campaign (same objective/budget/bid strategy) under a new name. The duplicate is created PAUSED. |
| `pause_campaign` | advertiser | Pauses a Meta campaign. |
| `resume_campaign` | advertiser | Resumes (activates) a paused Meta campaign. |
| `delete_campaign` | advertiser | Permanently deletes a Meta campaign. This cannot be undone. |
| `update_budget` | advertiser | Updates a campaign's daily and/or lifetime budget. |
| `bulk_pause_campaigns` | admin | Pauses up to 50 campaigns in one call. Returns a per-campaign success/failure result. |
| `bulk_resume_campaigns` | admin | Resumes up to 50 campaigns in one call. Returns a per-campaign success/failure result. |
| `bulk_update_budgets` | admin | Updates budgets for up to 50 campaigns in one call. Returns a per-campaign success/failure result. |

## Ad Sets

| Tool | Role | Description |
|---|---|---|
| `list_ad_sets` | viewer | Lists ad sets within a Meta campaign. |
| `create_ad_set` | advertiser | Creates a new ad set within a campaign, including audience targeting. Defaults to PAUSED status for safety. |
| `update_target_audience` | advertiser | Replaces an ad set's audience targeting (demographics, geo, interests, custom audiences, placements). |
| `bulk_update_target_audience` | admin | Updates targeting for up to 50 ad sets in one call. Returns a per-ad-set success/failure result. |

## Ads

| Tool | Role | Description |
|---|---|---|
| `list_ads` | viewer | Lists ads within a Meta ad set. |
| `create_ad` | advertiser | Creates a Meta ad (creative + ad) within an ad set. Supports Single Image, Carousel, Video, Collection, Reels, and Stories creative types via `creative.type`. Defaults to PAUSED status for safety. |
| `create_carousel_ad` | advertiser | Convenience tool for creating a Carousel ad (creative + ad) without assembling the creative payload by hand. |
| `bulk_create_ads` | admin | Creates up to 50 ads in one call. Returns a per-ad success/failure result. |

## Media

| Tool | Role | Description |
|---|---|---|
| `upload_image` | advertiser | Uploads an image to the ad account image library, returning its hash for use in ad creatives. |
| `upload_video` | advertiser | Uploads a video to the ad account video library, returning its ID for use in ad creatives. |
| `list_asset_library` | viewer | Lists every image and video in the ad account asset library. |

## Insights

| Tool | Role | Description |
|---|---|---|
| `campaign_insights` | analyst | Retrieves full Meta Ads Insights (spend, reach, impressions, CTR, CPM, CPC, CPA, ROAS, purchases, conversions, frequency, cost per result) with optional breakdowns and date range. |
| `retrieve_roas` | analyst | Retrieves Return on Ad Spend (ROAS) for campaigns/ad sets/ads. |
| `retrieve_ctr` | analyst | Retrieves Click-Through Rate (CTR) for campaigns/ad sets/ads. |
| `retrieve_cpc` | analyst | Retrieves Cost Per Click (CPC) for campaigns/ad sets/ads. |
| `retrieve_cpm` | analyst | Retrieves Cost Per Mille (CPM) for campaigns/ad sets/ads. |
| `retrieve_cpa` | analyst | Retrieves Cost Per Acquisition (CPA) for campaigns/ad sets/ads. |
| `retrieve_spend` | analyst | Retrieves ad spend for campaigns/ad sets/ads. |

## Leads

| Tool | Role | Description |
|---|---|---|
| `retrieve_leads` | analyst | Retrieves Meta lead generation data: pass `accountId` to list lead forms (names, status, lead counts), or pass `formId` to retrieve instant-form lead details for that form. |

## Pixel & Conversions API

| Tool | Role | Description |
|---|---|---|
| `list_pixels` | viewer | Lists Meta Pixels (and their IDs) associated with an ad account, for use with `retrieve_pixel_events` / `retrieve_conversion_api_diagnostics`. |
| `retrieve_pixel_events` | analyst | Retrieves aggregated Meta Pixel event counts (e.g. PageView, Purchase, Lead) for a date window. |
| `retrieve_conversion_api_diagnostics` | analyst | Compares a Pixel's browser-side events against server-side Conversions API events to surface coverage gaps (e.g. no server-side events detected). Does not compute Meta's internal Event Match Quality score, which isn't exposed through a documented read endpoint. |

## AI — Copywriting

All copywriting tools take a shared "brief" shape: `productOrService`, `targetAudience`, `keyBenefit`, optional `tone`, optional `objective`.

| Tool | Role | Description |
|---|---|---|
| `generate_ad_copy` | advertiser | Generates a complete, Meta-policy-aware ad copy set (primary text, headline, description, CTA) for a product/audience/benefit brief. |
| `generate_headlines` | advertiser | Generates several distinct headline options (Meta ~40 character guideline) for a product/audience/benefit brief. |
| `generate_primary_text` | advertiser | Generates several distinct primary ad text variants for a product/audience/benefit brief. |
| `generate_cta` | advertiser | Recommends the single best Meta call-to-action button type for a campaign brief. |

## AI — Recommendations

`recommend_budget` and `recommend_bid` fetch real historical Ads Insights internally (via the account/campaign scoping you provide) before asking the model for a number — they are not blind guesses.

| Tool | Role | Description |
|---|---|---|
| `recommend_budget` | advertiser | Recommends a daily budget grounded in real historical performance for the account or a specific campaign. |
| `recommend_audience` | advertiser | Recommends age range, gender, and interest targeting for a product/objective brief. |
| `recommend_bid` | advertiser | Recommends a bid strategy (and bid cap where applicable) grounded in real historical cost data. |
| `recommend_campaign_structure` | advertiser | Recommends how to split a monthly budget across ad sets for a new campaign. |
| `recommend_creative` | advertiser | Recommends the best-fit ad creative format (Single Image, Carousel, Video, Collection, Reels, Stories) for a brief and available assets. |

## AI — Reporting

`campaign_health_score`'s numeric score is computed deterministically from CTR/frequency/CPA signals (see `src/services/reporting.service.ts`) — the AI only writes the narrative summary, so the score itself is reproducible and auditable, not an LLM guess.

| Tool | Role | Description |
|---|---|---|
| `campaign_health_score` | analyst | Computes a deterministic 0-100 health score (from CTR, frequency, and CPA) for a campaign, with an AI-written summary and next action. |
| `daily_report` | analyst | Generates yesterday's performance report (spend/impressions/clicks/purchases totals plus an AI narrative) for an ad account. |
| `weekly_report` | analyst | Generates the last 7 days performance report for an ad account. |
| `monthly_report` | analyst | Generates the last 30 days performance report for an ad account. |

## Bulk operation semantics

`bulk_pause_campaigns`, `bulk_resume_campaigns`, `bulk_update_budgets`, `bulk_update_target_audience`, and `bulk_create_ads` all share the same result shape (`src/tools/bulk.util.ts`):

```json
{
  "total": 3,
  "succeeded": 2,
  "failed": 1,
  "items": [
    { "input": { "...": "..." }, "success": true, "result": { "...": "..." } },
    { "input": { "...": "..." }, "success": false, "error": "Meta API: campaign not found" }
  ]
}
```

Batches are capped at `BULK_MAX_BATCH_SIZE` (default 50) and run with bounded concurrency (`BULK_MAX_CONCURRENCY`, default 5) — a partial failure never blocks the rest of the batch, and the call itself never throws for an individual item's failure.
