import { env } from './env.js';

export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${env.META_API_VERSION}`;
export const META_OAUTH_DIALOG_URL = 'https://www.facebook.com/v21.0/dialog/oauth';

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

export const STORAGE_NAMESPACES = {
  META_TOKENS: 'meta-tokens',
  AUDIT_LOG: 'audit-log',
} as const;

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

export const BULK_OPERATION_LIMITS = {
  maxBatchSize: env.BULK_MAX_BATCH_SIZE,
  maxConcurrency: env.BULK_MAX_CONCURRENCY,
} as const;

export const MCP_TOOL_NAMESPACE = 'meta-ads';
