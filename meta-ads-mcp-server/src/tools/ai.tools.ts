import { z } from 'zod';
import { createTool } from './createTool.js';
import { connectionKeySchema, datePresetSchema } from './schemas.js';
import { resolveConnectionKey } from './connection.util.js';
import { metaProvider } from '../providers/meta/meta.provider.js';
import * as copyService from '../services/copy.service.js';
import * as recommendationService from '../services/recommendation.service.js';
import * as reportingService from '../services/reporting.service.js';

const adCopyBriefSchema = z.object({
  productOrService: z.string(),
  targetAudience: z.string(),
  keyBenefit: z.string(),
  tone: z.string().optional(),
  objective: z.string().optional(),
});

export const generateAdCopyTool = createTool({
  name: 'generate_ad_copy',
  description: 'Generates a complete, Meta-policy-aware ad copy set (primary text, headline, description, CTA) for a product/audience/benefit brief.',
  inputSchema: adCopyBriefSchema,
  handler: (input) => copyService.generateAdCopy(input),
});

const adCopyBriefWithCountSchema = adCopyBriefSchema.extend({
  count: z.number().int().min(1).max(10).optional(),
});

export const generateHeadlinesTool = createTool({
  name: 'generate_headlines',
  description: 'Generates several distinct headline options (Meta ~40 character guideline) for a product/audience/benefit brief.',
  inputSchema: adCopyBriefWithCountSchema,
  handler: ({ count, ...brief }) => copyService.generateHeadlines(brief, count),
});

export const generatePrimaryTextTool = createTool({
  name: 'generate_primary_text',
  description: 'Generates several distinct primary ad text variants for a product/audience/benefit brief.',
  inputSchema: adCopyBriefWithCountSchema,
  handler: ({ count, ...brief }) => copyService.generatePrimaryText(brief, count),
});

export const generateCtaTool = createTool({
  name: 'generate_cta',
  description: 'Recommends the single best Meta call-to-action button type for a campaign brief.',
  inputSchema: adCopyBriefSchema,
  handler: (input) => copyService.generateCta(input),
});

const recommendBudgetSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
  campaignId: z.string().optional().describe('Scope historical performance to one campaign. Omit to use account-wide performance.'),
  objective: z.string(),
  currency: z.string().describe('ISO currency code, e.g. USD.'),
  targetDailyResults: z.number().positive().optional(),
  datePreset: datePresetSchema.optional().describe('Historical window to analyze. Defaults to last_30d.'),
});

export const recommendBudgetTool = createTool({
  name: 'recommend_budget',
  description: 'Recommends a daily budget grounded in real historical performance for the account or a specific campaign.',
  inputSchema: recommendBudgetSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    const rows = await metaProvider.getInsights(connectionKey, {
      accountId: input.accountId,
      level: input.campaignId ? 'campaign' : 'account',
      campaignIds: input.campaignId ? [input.campaignId] : undefined,
      datePreset: input.datePreset ?? 'last_30d',
    });
    return recommendationService.recommendBudget({
      objective: input.objective,
      historicalInsights: rows,
      targetDailyResults: input.targetDailyResults,
      currency: input.currency,
    });
  },
});

const recommendAudienceSchema = z.object({
  productOrService: z.string(),
  objective: z.string(),
  existingTargetingSummary: z.string().optional(),
});

export const recommendAudienceTool = createTool({
  name: 'recommend_audience',
  description: 'Recommends age range, gender, and interest targeting for a product/objective brief.',
  inputSchema: recommendAudienceSchema,
  handler: (input) => recommendationService.recommendAudience(input),
});

const recommendBidSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
  campaignId: z.string().optional().describe('Scope historical performance to one campaign. Omit to use account-wide performance.'),
  objective: z.string(),
  optimizationGoal: z.string(),
  currency: z.string(),
  datePreset: datePresetSchema.optional().describe('Historical window to analyze. Defaults to last_30d.'),
});

export const recommendBidTool = createTool({
  name: 'recommend_bid',
  description: 'Recommends a bid strategy (and bid cap where applicable) grounded in real historical cost data.',
  inputSchema: recommendBidSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    const rows = await metaProvider.getInsights(connectionKey, {
      accountId: input.accountId,
      level: input.campaignId ? 'campaign' : 'account',
      campaignIds: input.campaignId ? [input.campaignId] : undefined,
      datePreset: input.datePreset ?? 'last_30d',
    });
    return recommendationService.recommendBid({
      objective: input.objective,
      optimizationGoal: input.optimizationGoal,
      historicalInsights: rows,
      currency: input.currency,
    });
  },
});

const recommendCampaignStructureSchema = z.object({
  productOrService: z.string(),
  objective: z.string(),
  monthlyBudgetCents: z.number().int().positive(),
  currency: z.string(),
});

export const recommendCampaignStructureTool = createTool({
  name: 'recommend_campaign_structure',
  description: 'Recommends how to split a monthly budget across ad sets for a new campaign.',
  inputSchema: recommendCampaignStructureSchema,
  handler: (input) => recommendationService.recommendCampaignStructure(input),
});

const recommendCreativeSchema = z.object({
  productOrService: z.string(),
  objective: z.string(),
  availableAssetTypes: z.array(z.enum(['image', 'video'])).min(1),
});

export const recommendCreativeTool = createTool({
  name: 'recommend_creative',
  description: 'Recommends the best-fit ad creative format (Single Image, Carousel, Video, Collection, Reels, Stories) for a brief and available assets.',
  inputSchema: recommendCreativeSchema,
  handler: (input) => recommendationService.recommendCreative(input),
});

const campaignHealthScoreSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
  campaignId: z.string(),
  datePreset: datePresetSchema.optional().describe('Historical window to analyze. Defaults to last_30d.'),
});

export const campaignHealthScoreTool = createTool({
  name: 'campaign_health_score',
  description: 'Computes a deterministic 0-100 health score (from CTR, frequency, and CPA) for a campaign, with an AI-written summary and next action.',
  inputSchema: campaignHealthScoreSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    const campaigns = await metaProvider.listCampaigns(connectionKey, input.accountId);
    const campaign = campaigns.find((c) => c.id === input.campaignId);
    if (!campaign) {
      throw new Error(`Campaign '${input.campaignId}' was not found in account '${input.accountId}'.`);
    }

    const rows = await metaProvider.getInsights(connectionKey, {
      accountId: input.accountId,
      level: 'campaign',
      campaignIds: [input.campaignId],
      datePreset: input.datePreset ?? 'last_30d',
    });

    return reportingService.computeCampaignHealthScore({
      campaignName: campaign.name,
      objective: campaign.objective,
      insights: rows,
    });
  },
});

const performanceReportSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
  accountName: z.string().optional().describe('Defaults to accountId if omitted.'),
});

function createReportTool(
  name: string,
  description: string,
  defaultDatePreset: z.infer<typeof datePresetSchema>,
  generate: (input: Omit<reportingService.PerformanceReportInput, 'period'>) => Promise<reportingService.PerformanceReport>,
) {
  return createTool({
    name,
    description,
    inputSchema: performanceReportSchema,
    handler: async (input) => {
      const connectionKey = await resolveConnectionKey(input.connectionKey);
      const rows = await metaProvider.getInsights(connectionKey, {
        accountId: input.accountId,
        level: 'account',
        datePreset: defaultDatePreset,
      });
      return generate({
        accountName: input.accountName ?? input.accountId,
        insights: rows,
      });
    },
  });
}

export const dailyReportTool = createReportTool(
  'daily_report',
  "Generates yesterday's performance report (spend/impressions/clicks/purchases totals plus an AI narrative) for an ad account.",
  'yesterday',
  (input) => reportingService.generateDailyReport(input),
);

export const weeklyReportTool = createReportTool(
  'weekly_report',
  'Generates the last 7 days performance report for an ad account.',
  'last_7d',
  (input) => reportingService.generateWeeklyReport(input),
);

export const monthlyReportTool = createReportTool(
  'monthly_report',
  'Generates the last 30 days performance report for an ad account.',
  'last_30d',
  (input) => reportingService.generateMonthlyReport(input),
);

export const aiTools = [
  generateAdCopyTool,
  generateHeadlinesTool,
  generatePrimaryTextTool,
  generateCtaTool,
  recommendBudgetTool,
  recommendAudienceTool,
  recommendBidTool,
  recommendCampaignStructureTool,
  recommendCreativeTool,
  campaignHealthScoreTool,
  dailyReportTool,
  weeklyReportTool,
  monthlyReportTool,
];
