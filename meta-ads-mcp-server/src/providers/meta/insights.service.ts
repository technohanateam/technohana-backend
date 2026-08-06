import { getFreshAccessToken } from '../../auth/tokenManager.js';
import { metaClient } from './client.js';
import { normalizeAccountId } from './accountId.util.js';
import type { InsightsQueryInput, MetaInsightsRow } from '../../types/meta.types.js';

const DEFAULT_FIELDS = [
  'date_start',
  'date_stop',
  'account_id',
  'campaign_id',
  'adset_id',
  'ad_id',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'frequency',
  'actions',
  'cost_per_action_type',
  'purchase_roas',
];

interface RawInsightAction {
  action_type: string;
  value: string;
}

interface RawInsightRow {
  date_start: string;
  date_stop: string;
  account_id?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  actions?: RawInsightAction[];
  cost_per_action_type?: RawInsightAction[];
  purchase_roas?: RawInsightAction[];
  [breakdownField: string]: unknown;
}

function findActionValue(actions: RawInsightAction[] | undefined, actionTypes: string[]): number | undefined {
  const match = actions?.find((action) => actionTypes.includes(action.action_type));
  return match ? Number(match.value) : undefined;
}

const PURCHASE_ACTION_TYPES = ['purchase', 'omni_purchase'];

function mapInsightRow(raw: RawInsightRow, breakdowns: string[] | undefined): MetaInsightsRow {
  const purchases = findActionValue(raw.actions, PURCHASE_ACTION_TYPES);
  const conversions = raw.actions
    ?.filter((action) => action.action_type.startsWith('offsite_conversion') || PURCHASE_ACTION_TYPES.includes(action.action_type))
    .reduce((sum, action) => sum + Number(action.value), 0);
  const costPerPurchase = findActionValue(raw.cost_per_action_type, PURCHASE_ACTION_TYPES);
  const roasEntry = raw.purchase_roas?.find((entry) => PURCHASE_ACTION_TYPES.includes(entry.action_type));

  const breakdown = breakdowns?.length
    ? Object.fromEntries(breakdowns.map((key) => [key, String(raw[key] ?? '')]))
    : undefined;

  return {
    dateStart: raw.date_start,
    dateStop: raw.date_stop,
    accountId: raw.account_id ? normalizeAccountId(raw.account_id) : '',
    campaignId: raw.campaign_id,
    adSetId: raw.adset_id,
    adId: raw.ad_id,
    spend: Number(raw.spend ?? 0),
    impressions: Number(raw.impressions ?? 0),
    reach: Number(raw.reach ?? 0),
    clicks: Number(raw.clicks ?? 0),
    ctr: Number(raw.ctr ?? 0),
    cpc: Number(raw.cpc ?? 0),
    cpm: Number(raw.cpm ?? 0),
    cpa: costPerPurchase,
    roas: roasEntry ? Number(roasEntry.value) : undefined,
    frequency: Number(raw.frequency ?? 0),
    purchases,
    conversions,
    costPerResult: costPerPurchase,
    breakdown,
  };
}

/**
 * Fetches Ads Insights for an account, optionally scoped to specific
 * campaigns/ad sets/ads via `filtering`, with either a date preset or an
 * explicit since/until range.
 */
export async function getInsights(connectionKey: string, query: InsightsQueryInput): Promise<MetaInsightsRow[]> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const accountId = normalizeAccountId(query.accountId);

  const filtering: Array<{ field: string; operator: 'IN'; value: string[] }> = [];
  if (query.campaignIds?.length) filtering.push({ field: 'campaign.id', operator: 'IN', value: query.campaignIds });
  if (query.adSetIds?.length) filtering.push({ field: 'adset.id', operator: 'IN', value: query.adSetIds });
  if (query.adIds?.length) filtering.push({ field: 'ad.id', operator: 'IN', value: query.adIds });

  const params: Record<string, string | number | boolean | undefined> = {
    level: query.level,
    fields: (query.fields?.length ? query.fields : DEFAULT_FIELDS).join(','),
    limit: 500,
  };
  if (query.breakdowns?.length) params.breakdowns = query.breakdowns.join(',');
  if (filtering.length) params.filtering = JSON.stringify(filtering);
  if (query.since && query.until) {
    params.time_range = JSON.stringify({ since: query.since, until: query.until });
  } else {
    params.date_preset = query.datePreset ?? 'last_30d';
  }

  const result = await metaClient.get<{ data: RawInsightRow[] }>(`/${accountId}/insights`, {
    accessToken,
    operationName: 'getInsights',
    params,
  });

  return result.data.data.map((row) => mapInsightRow(row, query.breakdowns));
}
