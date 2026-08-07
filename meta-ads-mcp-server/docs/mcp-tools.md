# MCP Tool Reference

106 tools total (47 Meta + 59 LinkedIn), grouped by area. **Role** is the minimum RBAC tier required to invoke the tool (see `src/config/roles.ts`) — roles are hierarchical: `admin` > `advertiser` > `analyst` > `viewer`, so a higher role can always call a lower tier's tools too. Every mutating tool (anything that creates/updates/deletes a Meta or LinkedIn resource) writes an audit log entry (`src/middleware/auditLogger.ts`).

Every Meta tool accepts an optional `connectionKey` argument identifying which stored Meta connection to use (a Business Manager ID from `list_businesses`, or `'personal'` if you have no Business Manager); every `linkedin_*` tool accepts the same shape for LinkedIn (an organization URN from `linkedin_list_organizations`, or `'personal'`). Omit it when exactly one connection of that platform is stored — it resolves automatically. See [README.md](../README.md#connecting-a-meta-account) and [linkedin-setup.md](./linkedin-setup.md) for how connections are established.

The Meta and LinkedIn tool sets are entirely separate — every LinkedIn tool name is prefixed `linkedin_` specifically so it can never collide with a same-purpose Meta tool (e.g. both platforms have "list ad accounts" and "create campaign" concepts, but as `list_ad_accounts`/`linkedin_list_ad_accounts` and `create_campaign`/`linkedin_create_campaign`).

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

---

# LinkedIn Ads Tools

59 tools. See [linkedin-setup.md](./linkedin-setup.md) for connecting a LinkedIn account.

## Organizations & Ad Accounts

| Tool | Role | Description |
|---|---|---|
| `linkedin_list_organizations` | viewer | Lists LinkedIn organizations (Company Pages) the connected member administers. |
| `linkedin_get_organization` | viewer | Retrieves a single LinkedIn organization by URN. |
| `linkedin_list_ad_accounts` | viewer | Lists LinkedIn ad accounts visible to the connected member, optionally scoped to one organization. |
| `linkedin_get_ad_account` | viewer | Retrieves a single LinkedIn ad account by URN. |

## Campaign Groups

| Tool | Role | Description |
|---|---|---|
| `linkedin_list_campaign_groups` | viewer | Lists campaign groups in a LinkedIn ad account. |
| `linkedin_create_campaign_group` | advertiser | Creates a new LinkedIn campaign group. Defaults to DRAFT status for safety. |
| `linkedin_update_campaign_group` | advertiser | Updates a LinkedIn campaign group (name, status, total budget, and/or run schedule). |
| `linkedin_archive_campaign_group` | advertiser | Archives a LinkedIn campaign group. This stops delivery for every campaign in it and cannot be undone. |

## Campaigns

| Tool | Role | Description |
|---|---|---|
| `linkedin_list_campaigns` | viewer | Lists campaigns in a LinkedIn ad account, optionally scoped to one campaign group. |
| `linkedin_create_campaign` | advertiser | Creates a new LinkedIn ad campaign. Defaults to DRAFT status for safety. |
| `linkedin_duplicate_campaign` | advertiser | Duplicates an existing campaign (same objective/type/cost structure/targeting) under a new name. The duplicate is created DRAFT. |
| `linkedin_pause_campaign` | advertiser | Pauses a LinkedIn campaign. |
| `linkedin_resume_campaign` | advertiser | Resumes (activates) a paused LinkedIn campaign. |
| `linkedin_archive_campaign` | advertiser | Archives a LinkedIn campaign. This stops delivery permanently and cannot be undone. |
| `linkedin_update_campaign` | advertiser | Updates a LinkedIn campaign (name, status, budget, bid, targeting, and/or run schedule). |
| `linkedin_bulk_pause_campaigns` | admin | Pauses up to 50 campaigns in one call. Returns a per-campaign success/failure result. |
| `linkedin_bulk_resume_campaigns` | admin | Resumes up to 50 campaigns in one call. Returns a per-campaign success/failure result. |

## Creatives

| Tool | Role | Description |
|---|---|---|
| `linkedin_list_creatives` | viewer | Lists creatives (ads) within a LinkedIn campaign. |
| `linkedin_create_single_image_ad` | advertiser | Creates a Single Image ad creative. Defaults to DRAFT status for safety. |
| `linkedin_create_video_ad` | advertiser | Creates a Video ad creative. Defaults to DRAFT status for safety. |
| `linkedin_create_carousel_ad` | advertiser | Creates a Carousel ad creative (at least 2 cards). Defaults to DRAFT status for safety. |
| `linkedin_update_creative` | advertiser | Updates a creative (headline, commentary, landing page, CTA, and/or status). |

## Media

| Tool | Role | Description |
|---|---|---|
| `linkedin_upload_image` | advertiser | Uploads an image, returning its asset URN for use in ad creatives. |
| `linkedin_upload_video` | advertiser | Uploads a video, returning its asset URN for use in ad creatives. |
| `linkedin_list_media_library` | viewer | Lists every image and video asset uploaded to the ad account. |
| `linkedin_validate_asset` | viewer | Checks a media asset's processing status and file size against LinkedIn's ad specs before it's used in a creative. |

## Audience & Budget

| Tool | Role | Description |
|---|---|---|
| `linkedin_estimate_audience` | viewer | Estimates the reachable audience size (low/high range) for a targeting spec. |
| `linkedin_update_targeting` | advertiser | Replaces a campaign's targeting criteria. |
| `linkedin_update_budget` | advertiser | Updates a campaign's daily and/or total budget. |
| `linkedin_update_bid` | advertiser | Updates a campaign's bid (unit cost) amount. |

## Insights

| Tool | Role | Description |
|---|---|---|
| `linkedin_campaign_insights` | analyst | Retrieves full LinkedIn Ads Analytics (impressions, clicks, spend, CTR, CPC, CPM, CPL, conversions, leads, video metrics, ROAS) pivoted by campaign, campaign group, creative, or account. |
| `linkedin_account_summary` | analyst | Retrieves account-level Analytics for a date range (one aggregated row across every campaign). |
| `linkedin_spend` | analyst | Retrieves ad spend. |
| `linkedin_clicks` | analyst | Retrieves clicks. |
| `linkedin_impressions` | analyst | Retrieves impressions. |
| `linkedin_ctr` | analyst | Retrieves Click-Through Rate (CTR). |
| `linkedin_cpc` | analyst | Retrieves Cost Per Click (CPC). |
| `linkedin_cpm` | analyst | Retrieves Cost Per Mille (CPM). |
| `linkedin_cpl` | analyst | Retrieves Cost Per Lead (CPL). |
| `linkedin_retrieve_leads_metric` | analyst | Retrieves one-click lead counts. |
| `linkedin_retrieve_conversions` | analyst | Retrieves external website conversions. |
| `linkedin_retrieve_roas` | analyst | Retrieves Return on Ad Spend (ROAS). |

All insights tools pivot by `ACCOUNT`/`CAMPAIGN`/`CAMPAIGN_GROUP`/`CREATIVE` and take a `since`/`until` (`YYYY-MM-DD`) date range.

## Lead Generation

| Tool | Role | Description |
|---|---|---|
| `linkedin_list_lead_gen_forms` | analyst | Lists Lead Gen Forms for an ad account (names, status, lead counts). |
| `linkedin_retrieve_leads` | analyst | Retrieves the most recent leads submitted through a form. |
| `linkedin_download_leads` | analyst | Downloads every lead submitted through a form (paginates through the full result set). |
| `linkedin_lead_statistics` | analyst | Computes lead volume statistics (total, last 7 days, last 30 days) for a form. |

## AI — Copywriting

All copywriting tools take a shared "brief" shape: `productOrService`, `targetAudience`, `keyBenefit`, optional `tone`, optional `objective`.

| Tool | Role | Description |
|---|---|---|
| `linkedin_generate_ad_copy` | advertiser | Generates a complete, LinkedIn-policy-aware ad copy set (commentary, headline, description, CTA). |
| `linkedin_generate_headlines` | advertiser | Generates several distinct headline options (~70 character guideline). |
| `linkedin_generate_descriptions` | advertiser | Generates several distinct commentary (intro text) variants. |
| `linkedin_generate_cta` | advertiser | Recommends the single best LinkedIn CTA label for a campaign brief. |

## AI — Recommendations

`linkedin_recommend_budget` and `linkedin_recommend_bid` fetch real historical Ads Analytics internally before asking Claude for a number — they are not blind guesses. `linkedin_recommend_targeting` returns suggested facet *category names* (e.g. "Software Development", "Director"), not resolved facet URNs — look each one up against LinkedIn's live targeting facets before passing it to `linkedin_update_targeting`.

| Tool | Role | Description |
|---|---|---|
| `linkedin_recommend_budget` | advertiser | Recommends a daily budget grounded in real historical performance for the account or a specific campaign. |
| `linkedin_recommend_bid` | advertiser | Recommends a bid (unit cost) amount grounded in real historical cost data. |
| `linkedin_recommend_targeting` | advertiser | Recommends targeting facet categories (industries, job functions, seniorities, company sizes) for a brief. |
| `linkedin_competitor_analysis` | advertiser | Produces a competitive positioning analysis (advantages, messaging gaps, recommended positioning). |

## AI — Reporting

`linkedin_campaign_health_score`'s numeric score is computed deterministically from CTR/click-to-lead-conversion/CPL signals (see `src/services/linkedinReporting.service.ts`) — the AI only writes the narrative summary. `linkedin_creative_score` is the same pattern applied to a creative's structural quality (commentary length, headline, CTA, landing page scheme).

| Tool | Role | Description |
|---|---|---|
| `linkedin_campaign_health_score` | analyst | Computes a deterministic 0-100 health score (from CTR, click-to-lead conversion, and CPL) with an AI-written summary and next action. |
| `linkedin_daily_report` | analyst | Generates yesterday's performance report (spend/impressions/clicks/leads totals plus an AI narrative). |
| `linkedin_weekly_report` | analyst | Generates the last 7 days performance report. |
| `linkedin_monthly_report` | analyst | Generates the last 30 days performance report. |
| `linkedin_creative_score` | analyst | Computes a deterministic 0-100 structural quality score for a creative with an AI-written critique. |
