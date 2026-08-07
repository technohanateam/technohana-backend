import { env } from './env.js';

export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${env.META_API_VERSION}`;
export const META_OAUTH_DIALOG_URL = 'https://www.facebook.com/v21.0/dialog/oauth';

export const LINKEDIN_API_BASE_URL = 'https://api.linkedin.com/rest';
export const LINKEDIN_OAUTH_DIALOG_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_OAUTH_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

/** LinkedIn REST API HTTP statuses considered transient/retryable. */
export const LINKEDIN_RETRYABLE_HTTP_STATUSES = new Set<number>([429, 500, 502, 503, 504]);

/** LinkedIn REST API HTTP status that indicates an expired or invalid access token. */
export const LINKEDIN_TOKEN_ERROR_HTTP_STATUSES = new Set<number>([401]);

/** LinkedIn REST API HTTP status that indicates a permission/scope problem. */
export const LINKEDIN_PERMISSION_ERROR_HTTP_STATUSES = new Set<number>([403]);

export const LINKEDIN_RETRY_DEFAULTS = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  jitterRatio: 0.2,
} as const;

/** LinkedIn's documented Marketing API asset limits (Image Ads / Video Ads specs). */
export const LINKEDIN_ASSET_LIMITS = {
  maxImageBytes: 5 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
} as const;

/** Meta Graph API error codes considered transient/retryable. */
export const META_RETRYABLE_ERROR_CODES = new Set<number>([1, 2, 4, 17, 32, 613]);

/** Meta Graph API error codes that indicate an expired or invalid access token. */
export const META_TOKEN_ERROR_CODES = new Set<number>([190]);

/** Meta Graph API error codes that indicate a permissions problem. */
export const META_PERMISSION_ERROR_CODES = new Set<number>([10, 200, 299]);

export const RETRY_DEFAULTS = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  jitterRatio: 0.2,
} as const;

export const CACHE_NAMESPACES = {
  AD_ACCOUNTS: 'ad-accounts',
  BUSINESSES: 'businesses',
  PIXELS: 'pixels',
  ASSET_LIBRARY: 'asset-library',
  CAMPAIGN_METADATA: 'campaign-metadata',
} as const;

export const CACHE_TTL_SECONDS: Record<(typeof CACHE_NAMESPACES)[keyof typeof CACHE_NAMESPACES], number> = {
  [CACHE_NAMESPACES.AD_ACCOUNTS]: env.CACHE_TTL_AD_ACCOUNTS_SECONDS,
  [CACHE_NAMESPACES.BUSINESSES]: env.CACHE_TTL_BUSINESSES_SECONDS,
  [CACHE_NAMESPACES.PIXELS]: env.CACHE_TTL_PIXELS_SECONDS,
  [CACHE_NAMESPACES.ASSET_LIBRARY]: env.CACHE_TTL_ASSET_LIBRARY_SECONDS,
  [CACHE_NAMESPACES.CAMPAIGN_METADATA]: env.CACHE_TTL_CAMPAIGN_METADATA_SECONDS,
};

export const LINKEDIN_CACHE_NAMESPACES = {
  ORGANIZATIONS: 'linkedin-organizations',
  AD_ACCOUNTS: 'linkedin-ad-accounts',
  CAMPAIGN_METADATA: 'linkedin-campaign-metadata',
  CREATIVES: 'linkedin-creatives',
  AUDIENCE_ESTIMATES: 'linkedin-audience-estimates',
} as const;

export const LINKEDIN_CACHE_TTL_SECONDS: Record<
  (typeof LINKEDIN_CACHE_NAMESPACES)[keyof typeof LINKEDIN_CACHE_NAMESPACES],
  number
> = {
  [LINKEDIN_CACHE_NAMESPACES.ORGANIZATIONS]: env.CACHE_TTL_LINKEDIN_ORGANIZATIONS_SECONDS,
  [LINKEDIN_CACHE_NAMESPACES.AD_ACCOUNTS]: env.CACHE_TTL_LINKEDIN_AD_ACCOUNTS_SECONDS,
  [LINKEDIN_CACHE_NAMESPACES.CAMPAIGN_METADATA]: env.CACHE_TTL_LINKEDIN_CAMPAIGN_METADATA_SECONDS,
  [LINKEDIN_CACHE_NAMESPACES.CREATIVES]: env.CACHE_TTL_LINKEDIN_CREATIVES_SECONDS,
  [LINKEDIN_CACHE_NAMESPACES.AUDIENCE_ESTIMATES]: env.CACHE_TTL_LINKEDIN_AUDIENCE_ESTIMATES_SECONDS,
};

export const STORAGE_NAMESPACES = {
  META_TOKENS: 'meta-tokens',
  LINKEDIN_TOKENS: 'linkedin-tokens',
  AUDIT_LOG: 'audit-log',
  OAUTH_CLIENTS: 'oauth-clients',
  OAUTH_PENDING_AUTHORIZATIONS: 'oauth-pending-authorizations',
  OAUTH_CODES: 'oauth-codes',
} as const;

/** How long a pending authorize() consent screen stays valid before the operator must restart the flow. */
export const OAUTH_PENDING_AUTHORIZATION_TTL_SECONDS = 600;
/** Standard short-lived authorization code lifetime (single-use, exchanged for an access token). */
export const OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 600;

/** Meta Ads objectives under the current Outcome-Driven Ads Experiences (ODAX) model. */
export const META_CAMPAIGN_OBJECTIVES = [
  'OUTCOME_TRAFFIC',
  'OUTCOME_SALES',
  'OUTCOME_LEADS',
  'OUTCOME_AWARENESS',
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_APP_PROMOTION',
] as const;

export type MetaCampaignObjective = (typeof META_CAMPAIGN_OBJECTIVES)[number];

/** LinkedIn Marketing API campaign objectives (Campaign Manager objective types). */
export const LINKEDIN_CAMPAIGN_OBJECTIVES = [
  'BRAND_AWARENESS',
  'WEBSITE_VISITS',
  'ENGAGEMENT',
  'VIDEO_VIEWS',
  'LEAD_GENERATION',
  'WEBSITE_CONVERSIONS',
  'JOB_APPLICANTS',
  'TALENT_LEADS',
] as const;

export type LinkedInCampaignObjective = (typeof LINKEDIN_CAMPAIGN_OBJECTIVES)[number];

export const LINKEDIN_CAMPAIGN_COST_TYPES = ['CPC', 'CPM', 'CPV'] as const;
export type LinkedInCampaignCostType = (typeof LINKEDIN_CAMPAIGN_COST_TYPES)[number];

export const LINKEDIN_CAMPAIGN_TYPES = ['SPONSORED_UPDATES', 'TEXT_AD', 'SPONSORED_INMAILS', 'DYNAMIC'] as const;
export type LinkedInCampaignType = (typeof LINKEDIN_CAMPAIGN_TYPES)[number];

export const BULK_OPERATION_LIMITS = {
  maxBatchSize: env.BULK_MAX_BATCH_SIZE,
  maxConcurrency: env.BULK_MAX_CONCURRENCY,
} as const;

export const MCP_TOOL_NAMESPACE = 'meta-ads';
export const LINKEDIN_MCP_TOOL_NAMESPACE = 'linkedin-ads';
