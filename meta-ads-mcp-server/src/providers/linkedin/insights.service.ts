import { getFreshAccessToken } from '../../auth/linkedinTokenManager.js';
import { linkedinClient } from './client.js';
import { getAdAccount } from './accounts.service.js';
import type { LinkedInInsightsQueryInput, LinkedInInsightsRow } from '../../types/linkedin.types.js';

const INSIGHTS_FIELDS = [
  'dateRange',
  'pivotValues',
  'impressions',
  'clicks',
  'costInLocalCurrency',
  'externalWebsiteConversions',
  'oneClickLeads',
  'videoViews',
  'videoCompletions',
  'conversionValueInLocalCurrency',
].join(',');

interface RawDateRange {
  start: { day: number; month: number; year: number };
  end?: { day: number; month: number; year: number };
}

interface RawInsightsRow {
  dateRange: RawDateRange;
  pivotValues?: string[];
  impressions?: number;
  clicks?: number;
  costInLocalCurrency?: string;
  externalWebsiteConversions?: number;
  oneClickLeads?: number;
  videoViews?: number;
  videoCompletions?: number;
  conversionValueInLocalCurrency?: string;
}

interface RawInsightsResponse {
  elements: RawInsightsRow[];
}

function toDateString(date: RawDateRange['start']): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function parseDateRangeParam(since: string, until: string): string {
  const [startYear, startMonth, startDay] = since.split('-').map(Number);
  const [endYear, endMonth, endDay] = until.split('-').map(Number);
  return JSON.stringify({
    start: { day: startDay, month: startMonth, year: startYear },
    end: { day: endDay, month: endMonth, year: endYear },
  });
}

/** REST.li 2.0 encodes list-valued query params as `List(a,b,c)`. */
function toRestliList(values: string[]): string {
  return `List(${values.join(',')})`;
}

function mapInsightRow(
  raw: RawInsightsRow,
  accountUrn: string,
  currency: string,
  pivot: LinkedInInsightsQueryInput['pivot'],
): LinkedInInsightsRow {
  const impressions = raw.impressions ?? 0;
  const clicks = raw.clicks ?? 0;
  const cost = raw.costInLocalCurrency ? Number(raw.costInLocalCurrency) : 0;
  const conversionValue = raw.conversionValueInLocalCurrency ? Number(raw.conversionValueInLocalCurrency) : undefined;
  const pivotUrn = raw.pivotValues?.[0];

  return {
    dateRangeStart: toDateString(raw.dateRange.start),
    dateRangeEnd: raw.dateRange.end ? toDateString(raw.dateRange.end) : toDateString(raw.dateRange.start),
    accountUrn,
    campaignUrn: pivot === 'CAMPAIGN' ? pivotUrn : undefined,
    campaignGroupUrn: pivot === 'CAMPAIGN_GROUP' ? pivotUrn : undefined,
    creativeUrn: pivot === 'CREATIVE' ? pivotUrn : undefined,
    impressions,
    clicks,
    costInLocalCurrency: cost,
    currency,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpc: clicks > 0 ? cost / clicks : 0,
    cpm: impressions > 0 ? (cost / impressions) * 1000 : 0,
    externalWebsiteConversions: raw.externalWebsiteConversions,
    oneClickLeads: raw.oneClickLeads,
    cpl: raw.oneClickLeads && raw.oneClickLeads > 0 ? cost / raw.oneClickLeads : undefined,
    videoViews: raw.videoViews,
    videoCompletions: raw.videoCompletions,
    conversionValueInLocalCurrency: conversionValue,
    roas: conversionValue !== undefined && cost > 0 ? conversionValue / cost : undefined,
  };
}

/** Fetches LinkedIn Ads Analytics, pivoted by account/campaign/campaign group/creative, for a date range. */
export async function getInsights(connectionKey: string, query: LinkedInInsightsQueryInput): Promise<LinkedInInsightsRow[]> {
  const accessToken = await getFreshAccessToken(connectionKey);

  const params: Record<string, string> = {
    q: 'analytics',
    pivot: query.pivot,
    dateRange: parseDateRangeParam(query.since, query.until),
    timeGranularity: query.timeGranularity ?? 'ALL',
    accounts: toRestliList([query.accountUrn]),
    fields: INSIGHTS_FIELDS,
  };
  if (query.campaignUrns?.length) params.campaigns = toRestliList(query.campaignUrns);
  if (query.campaignGroupUrns?.length) params.campaignGroups = toRestliList(query.campaignGroupUrns);

  const [result, account] = await Promise.all([
    linkedinClient.get<RawInsightsResponse>('/adAnalytics', {
      accessToken,
      operationName: 'getInsights',
      params,
    }),
    getAdAccount(connectionKey, query.accountUrn),
  ]);

  return result.data.elements.map((row) => mapInsightRow(row, query.accountUrn, account.currency, query.pivot));
}
