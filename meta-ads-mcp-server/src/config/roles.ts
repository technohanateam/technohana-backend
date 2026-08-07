export const ROLES = ['viewer', 'analyst', 'advertiser', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Read-only tools: available to every authenticated role.
 */
export const READ_ONLY_TOOLS = [
  'list_ad_accounts',
  'list_businesses',
  'list_campaigns',
  'list_ad_sets',
  'list_ads',
  'list_asset_library',
  'list_pixels',
  'linkedin_list_organizations',
  'linkedin_get_organization',
  'linkedin_list_ad_accounts',
  'linkedin_get_ad_account',
  'linkedin_list_campaign_groups',
  'linkedin_list_campaigns',
  'linkedin_list_creatives',
  'linkedin_list_media_library',
  'linkedin_validate_asset',
  'linkedin_estimate_audience',
] as const;

/**
 * Insights/reporting tools: available from 'analyst' upward.
 */
export const ANALYST_TOOLS = [
  'campaign_insights',
  'retrieve_roas',
  'retrieve_ctr',
  'retrieve_cpc',
  'retrieve_cpm',
  'retrieve_cpa',
  'retrieve_spend',
  'retrieve_leads',
  'retrieve_pixel_events',
  'retrieve_conversion_api_diagnostics',
  'campaign_health_score',
  'daily_report',
  'weekly_report',
  'monthly_report',
  'linkedin_campaign_insights',
  'linkedin_account_summary',
  'linkedin_spend',
  'linkedin_clicks',
  'linkedin_impressions',
  'linkedin_ctr',
  'linkedin_cpc',
  'linkedin_cpm',
  'linkedin_cpl',
  'linkedin_retrieve_leads_metric',
  'linkedin_retrieve_conversions',
  'linkedin_retrieve_roas',
  'linkedin_list_lead_gen_forms',
  'linkedin_retrieve_leads',
  'linkedin_download_leads',
  'linkedin_lead_statistics',
] as const;

/**
 * Write/mutating tools: available from 'advertiser' upward.
 */
export const ADVERTISER_TOOLS = [
  'create_campaign',
  'duplicate_campaign',
  'pause_campaign',
  'resume_campaign',
  'delete_campaign',
  'update_budget',
  'create_ad_set',
  'update_target_audience',
  'create_ad',
  'create_carousel_ad',
  'upload_image',
  'upload_video',
  'recommend_budget',
  'recommend_audience',
  'recommend_bid',
  'recommend_campaign_structure',
  'recommend_creative',
  'generate_ad_copy',
  'generate_headlines',
  'generate_primary_text',
  'generate_cta',
  'linkedin_create_campaign_group',
  'linkedin_update_campaign_group',
  'linkedin_archive_campaign_group',
  'linkedin_create_campaign',
  'linkedin_duplicate_campaign',
  'linkedin_pause_campaign',
  'linkedin_resume_campaign',
  'linkedin_archive_campaign',
  'linkedin_update_campaign',
  'linkedin_create_single_image_ad',
  'linkedin_create_video_ad',
  'linkedin_create_carousel_ad',
  'linkedin_update_creative',
  'linkedin_upload_image',
  'linkedin_upload_video',
  'linkedin_update_targeting',
  'linkedin_update_budget',
  'linkedin_update_bid',
] as const;

/**
 * Bulk + account/business-management tools: 'admin' only.
 */
export const ADMIN_TOOLS = [
  'bulk_pause_campaigns',
  'bulk_resume_campaigns',
  'bulk_update_budgets',
  'bulk_update_target_audience',
  'bulk_create_ads',
  'linkedin_bulk_pause_campaigns',
  'linkedin_bulk_resume_campaigns',
] as const;

export type ToolName =
  | (typeof READ_ONLY_TOOLS)[number]
  | (typeof ANALYST_TOOLS)[number]
  | (typeof ADVERTISER_TOOLS)[number]
  | (typeof ADMIN_TOOLS)[number];

const ROLE_HIERARCHY: Record<Role, number> = {
  viewer: 0,
  analyst: 1,
  advertiser: 2,
  admin: 3,
};

const TOOL_MIN_ROLE: Partial<Record<ToolName, Role>> = {};
for (const tool of READ_ONLY_TOOLS) TOOL_MIN_ROLE[tool] = 'viewer';
for (const tool of ANALYST_TOOLS) TOOL_MIN_ROLE[tool] = 'analyst';
for (const tool of ADVERTISER_TOOLS) TOOL_MIN_ROLE[tool] = 'advertiser';
for (const tool of ADMIN_TOOLS) TOOL_MIN_ROLE[tool] = 'admin';

/**
 * Returns true if `role` is permitted to invoke `toolName`.
 * Unknown tool names are denied by default (fail closed).
 */
export function isToolAllowedForRole(role: Role, toolName: string): boolean {
  const minRole = TOOL_MIN_ROLE[toolName as ToolName];
  if (!minRole) return false;
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minRole];
}

export function isValidRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
