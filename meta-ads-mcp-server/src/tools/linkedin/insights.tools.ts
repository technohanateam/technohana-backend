import type { z } from 'zod';
import { createTool } from '../createTool.js';
import { linkedinInsightsQuerySchema } from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as insightsService from '../../providers/linkedin/insights.service.js';
import type { LinkedInInsightsRow } from '../../types/linkedin.types.js';

type InsightsQueryToolInput = z.infer<typeof linkedinInsightsQuerySchema>;

async function fetchInsights(input: InsightsQueryToolInput) {
  const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
  return insightsService.getInsights(connectionKey, {
    accountUrn: input.accountUrn,
    pivot: input.pivot,
    campaignUrns: input.campaignUrns,
    campaignGroupUrns: input.campaignGroupUrns,
    since: input.since,
    until: input.until,
    timeGranularity: input.timeGranularity,
  });
}

export const campaignInsightsTool = createTool({
  name: 'linkedin_campaign_insights',
  description: 'Retrieves full LinkedIn Ads Analytics (impressions, clicks, spend, CTR, CPC, CPM, CPL, conversions, leads, video metrics, ROAS) pivoted by campaign, campaign group, creative, or account.',
  inputSchema: linkedinInsightsQuerySchema,
  handler: (input) => fetchInsights(input),
});

export const accountSummaryTool = createTool({
  name: 'linkedin_account_summary',
  description: 'Retrieves account-level LinkedIn Ads Analytics for a date range (one aggregated row across every campaign in the account).',
  inputSchema: linkedinInsightsQuerySchema,
  handler: (input) => fetchInsights({ ...input, pivot: 'ACCOUNT' }),
});

function projectMetric<K extends keyof LinkedInInsightsRow>(rows: LinkedInInsightsRow[], metric: K) {
  return rows.map((row) => ({
    dateRangeStart: row.dateRangeStart,
    dateRangeEnd: row.dateRangeEnd,
    campaignUrn: row.campaignUrn,
    campaignGroupUrn: row.campaignGroupUrn,
    creativeUrn: row.creativeUrn,
    [metric]: row[metric],
  }));
}

function createMetricTool(name: string, description: string, metric: keyof LinkedInInsightsRow) {
  return createTool({
    name,
    description,
    inputSchema: linkedinInsightsQuerySchema,
    handler: async (input) => {
      const rows = await fetchInsights(input);
      return projectMetric(rows, metric);
    },
  });
}

export const spendTool = createMetricTool('linkedin_spend', 'Retrieves ad spend for LinkedIn campaigns/campaign groups/creatives.', 'costInLocalCurrency');
export const clicksTool = createMetricTool('linkedin_clicks', 'Retrieves clicks for LinkedIn campaigns/campaign groups/creatives.', 'clicks');
export const impressionsTool = createMetricTool('linkedin_impressions', 'Retrieves impressions for LinkedIn campaigns/campaign groups/creatives.', 'impressions');
export const ctrTool = createMetricTool('linkedin_ctr', 'Retrieves Click-Through Rate (CTR) for LinkedIn campaigns/campaign groups/creatives.', 'ctr');
export const cpcTool = createMetricTool('linkedin_cpc', 'Retrieves Cost Per Click (CPC) for LinkedIn campaigns/campaign groups/creatives.', 'cpc');
export const cpmTool = createMetricTool('linkedin_cpm', 'Retrieves Cost Per Mille (CPM) for LinkedIn campaigns/campaign groups/creatives.', 'cpm');
export const cplTool = createMetricTool('linkedin_cpl', 'Retrieves Cost Per Lead (CPL) for LinkedIn campaigns/campaign groups/creatives.', 'cpl');
export const leadsMetricTool = createMetricTool('linkedin_retrieve_leads_metric', 'Retrieves one-click lead counts for LinkedIn campaigns/campaign groups/creatives.', 'oneClickLeads');
export const conversionsTool = createMetricTool('linkedin_retrieve_conversions', 'Retrieves external website conversions for LinkedIn campaigns/campaign groups/creatives.', 'externalWebsiteConversions');
export const roasTool = createMetricTool('linkedin_retrieve_roas', 'Retrieves Return on Ad Spend (ROAS) for LinkedIn campaigns/campaign groups/creatives.', 'roas');

export const insightsTools = [
  campaignInsightsTool,
  accountSummaryTool,
  spendTool,
  clicksTool,
  impressionsTool,
  ctrTool,
  cpcTool,
  cpmTool,
  cplTool,
  leadsMetricTool,
  conversionsTool,
  roasTool,
];
