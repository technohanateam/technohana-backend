import { z } from 'zod';
import { createTool } from './createTool.js';
import { connectionKeySchema, datePresetSchema } from './schemas.js';
import { resolveConnectionKey } from './connection.util.js';
import { metaProvider } from '../providers/meta/meta.provider.js';
import type { MetaInsightsRow } from '../types/meta.types.js';

const insightsQuerySchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
  level: z.enum(['account', 'campaign', 'adset', 'ad']).default('campaign'),
  campaignIds: z.array(z.string()).optional().describe('Restrict to specific campaigns.'),
  adSetIds: z.array(z.string()).optional().describe('Restrict to specific ad sets.'),
  adIds: z.array(z.string()).optional().describe('Restrict to specific ads.'),
  datePreset: datePresetSchema.optional().describe('Defaults to last_30d when since/until are not provided.'),
  since: z.string().optional().describe('YYYY-MM-DD. Use with `until` for a custom range instead of datePreset.'),
  until: z.string().optional().describe('YYYY-MM-DD.'),
  breakdowns: z.array(z.string()).optional().describe('e.g. ["age", "gender"], ["publisher_platform"], ["country"].'),
});

type InsightsQueryToolInput = z.infer<typeof insightsQuerySchema>;

async function fetchInsights(connectionKeyInput: string | undefined, query: Omit<InsightsQueryToolInput, 'connectionKey'>) {
  const connectionKey = await resolveConnectionKey(connectionKeyInput);
  return metaProvider.getInsights(connectionKey, query);
}

export const campaignInsightsTool = createTool({
  name: 'campaign_insights',
  description: 'Retrieves full Meta Ads Insights (spend, reach, impressions, CTR, CPM, CPC, CPA, ROAS, purchases, conversions, frequency, cost per result) with optional breakdowns and date range.',
  inputSchema: insightsQuerySchema,
  handler: async (input) => {
    const { connectionKey, ...query } = input;
    return fetchInsights(connectionKey, query);
  },
});

function projectMetric<K extends keyof MetaInsightsRow>(rows: MetaInsightsRow[], metric: K) {
  return rows.map((row) => ({
    dateStart: row.dateStart,
    dateStop: row.dateStop,
    campaignId: row.campaignId,
    adSetId: row.adSetId,
    adId: row.adId,
    [metric]: row[metric],
  }));
}

function createMetricTool(name: string, description: string, metric: keyof MetaInsightsRow) {
  return createTool({
    name,
    description,
    inputSchema: insightsQuerySchema,
    handler: async (input) => {
      const { connectionKey, ...query } = input;
      const rows = await fetchInsights(connectionKey, query);
      return projectMetric(rows, metric);
    },
  });
}

export const retrieveRoasTool = createMetricTool('retrieve_roas', 'Retrieves Return on Ad Spend (ROAS) for campaigns/ad sets/ads.', 'roas');
export const retrieveCtrTool = createMetricTool('retrieve_ctr', 'Retrieves Click-Through Rate (CTR) for campaigns/ad sets/ads.', 'ctr');
export const retrieveCpcTool = createMetricTool('retrieve_cpc', 'Retrieves Cost Per Click (CPC) for campaigns/ad sets/ads.', 'cpc');
export const retrieveCpmTool = createMetricTool('retrieve_cpm', 'Retrieves Cost Per Mille (CPM) for campaigns/ad sets/ads.', 'cpm');
export const retrieveCpaTool = createMetricTool('retrieve_cpa', 'Retrieves Cost Per Acquisition (CPA) for campaigns/ad sets/ads.', 'cpa');
export const retrieveSpendTool = createMetricTool('retrieve_spend', 'Retrieves ad spend for campaigns/ad sets/ads.', 'spend');

export const insightsTools = [
  campaignInsightsTool,
  retrieveRoasTool,
  retrieveCtrTool,
  retrieveCpcTool,
  retrieveCpmTool,
  retrieveCpaTool,
  retrieveSpendTool,
];
