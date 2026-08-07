import { z } from 'zod';
import { createTool } from '../createTool.js';
import { linkedinConnectionKeySchema } from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as insightsService from '../../providers/linkedin/insights.service.js';
import * as campaignsService from '../../providers/linkedin/campaigns.service.js';
import * as creativesService from '../../providers/linkedin/creatives.service.js';
import * as copyService from '../../services/linkedinCopy.service.js';
import * as recommendationService from '../../services/linkedinRecommendation.service.js';
import * as reportingService from '../../services/linkedinReporting.service.js';

/** Default lookback window (YYYY-MM-DD) when a caller doesn't specify an explicit date range. */
function defaultDateRange(days: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: toIso(since), until: toIso(until) };
}

const adCopyBriefSchema = z.object({
  productOrService: z.string(),
  targetAudience: z.string(),
  keyBenefit: z.string(),
  tone: z.string().optional(),
  objective: z.string().optional(),
});

export const generateAdCopyTool = createTool({
  name: 'linkedin_generate_ad_copy',
  description: 'Generates a complete, LinkedIn-policy-aware ad copy set (commentary, headline, description, CTA) for a product/audience/benefit brief.',
  inputSchema: adCopyBriefSchema,
  handler: (input) => copyService.generateAdCopy(input),
});

const adCopyBriefWithCountSchema = adCopyBriefSchema.extend({
  count: z.number().int().min(1).max(10).optional(),
});

export const generateHeadlinesTool = createTool({
  name: 'linkedin_generate_headlines',
  description: 'Generates several distinct headline options (LinkedIn ~70 character guideline) for a product/audience/benefit brief.',
  inputSchema: adCopyBriefWithCountSchema,
  handler: ({ count, ...brief }) => copyService.generateHeadlines(brief, count),
});

export const generateDescriptionsTool = createTool({
  name: 'linkedin_generate_descriptions',
  description: 'Generates several distinct commentary (intro text) variants for a product/audience/benefit brief.',
  inputSchema: adCopyBriefWithCountSchema,
  handler: ({ count, ...brief }) => copyService.generateDescriptions(brief, count),
});

export const generateCtaTool = createTool({
  name: 'linkedin_generate_cta',
  description: 'Recommends the single best LinkedIn call-to-action label for a campaign brief.',
  inputSchema: adCopyBriefSchema,
  handler: (input) => copyService.generateCta(input),
});

const recommendBudgetSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  campaignUrn: z.string().optional().describe('Scope historical performance to one campaign. Omit to use account-wide performance.'),
  objectiveType: z.string(),
  currency: z.string().describe('ISO currency code, e.g. USD.'),
  targetDailyResults: z.number().positive().optional(),
  since: z.string().optional().describe('YYYY-MM-DD. Defaults to 30 days ago.'),
  until: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
});

export const recommendBudgetTool = createTool({
  name: 'linkedin_recommend_budget',
  description: 'Recommends a daily budget grounded in real historical performance for the account or a specific campaign.',
  inputSchema: recommendBudgetSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    const { since, until } = input.since && input.until ? { since: input.since, until: input.until } : defaultDateRange(30);
    const rows = await insightsService.getInsights(connectionKey, {
      accountUrn: input.accountUrn,
      pivot: input.campaignUrn ? 'CAMPAIGN' : 'ACCOUNT',
      campaignUrns: input.campaignUrn ? [input.campaignUrn] : undefined,
      since,
      until,
    });
    return recommendationService.recommendBudget({
      objectiveType: input.objectiveType,
      historicalInsights: rows,
      targetDailyResults: input.targetDailyResults,
      currency: input.currency,
    });
  },
});

const recommendBidSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  campaignUrn: z.string().optional().describe('Scope historical performance to one campaign. Omit to use account-wide performance.'),
  objectiveType: z.string(),
  costType: z.string(),
  currency: z.string(),
  since: z.string().optional().describe('YYYY-MM-DD. Defaults to 30 days ago.'),
  until: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
});

export const recommendBidTool = createTool({
  name: 'linkedin_recommend_bid',
  description: 'Recommends a bid (unit cost) amount grounded in real historical cost data.',
  inputSchema: recommendBidSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    const { since, until } = input.since && input.until ? { since: input.since, until: input.until } : defaultDateRange(30);
    const rows = await insightsService.getInsights(connectionKey, {
      accountUrn: input.accountUrn,
      pivot: input.campaignUrn ? 'CAMPAIGN' : 'ACCOUNT',
      campaignUrns: input.campaignUrn ? [input.campaignUrn] : undefined,
      since,
      until,
    });
    return recommendationService.recommendBid({
      objectiveType: input.objectiveType,
      costType: input.costType,
      historicalInsights: rows,
      currency: input.currency,
    });
  },
});

const recommendTargetingSchema = z.object({
  productOrService: z.string(),
  objective: z.string(),
  existingTargetingSummary: z.string().optional(),
});

export const recommendTargetingTool = createTool({
  name: 'linkedin_recommend_targeting',
  description: 'Recommends targeting facet categories (industries, job functions, seniorities, company sizes) for a product/objective brief. Returns category names to look up, not resolved facet URNs.',
  inputSchema: recommendTargetingSchema,
  handler: (input) => recommendationService.recommendTargeting(input),
});

const competitorAnalysisSchema = z.object({
  productOrService: z.string(),
  competitorNameOrDescription: z.string(),
  objective: z.string(),
});

export const competitorAnalysisTool = createTool({
  name: 'linkedin_competitor_analysis',
  description: 'Produces a competitive positioning analysis (advantages, messaging gaps, recommended positioning) for a LinkedIn campaign brief.',
  inputSchema: competitorAnalysisSchema,
  handler: (input) => recommendationService.analyzeCompetitor(input),
});

const campaignHealthScoreSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  campaignUrn: z.string(),
  since: z.string().optional().describe('YYYY-MM-DD. Defaults to 30 days ago.'),
  until: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
});

export const campaignHealthScoreTool = createTool({
  name: 'linkedin_campaign_health_score',
  description: 'Computes a deterministic 0-100 health score (from CTR, click-to-lead conversion, and CPL) for a campaign, with an AI-written summary and next action.',
  inputSchema: campaignHealthScoreSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    const { since, until } = input.since && input.until ? { since: input.since, until: input.until } : defaultDateRange(30);
    const [campaign, rows] = await Promise.all([
      campaignsService.getCampaign(connectionKey, input.campaignUrn),
      insightsService.getInsights(connectionKey, {
        accountUrn: input.accountUrn,
        pivot: 'CAMPAIGN',
        campaignUrns: [input.campaignUrn],
        since,
        until,
      }),
    ]);
    return reportingService.computeCampaignHealthScore({
      campaignName: campaign.name,
      objectiveType: campaign.objectiveType,
      insights: rows,
    });
  },
});

const performanceReportSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  accountName: z.string().optional().describe('Defaults to accountUrn if omitted.'),
});

function createReportTool(
  name: string,
  description: string,
  lookbackDays: number,
  generate: (input: Omit<reportingService.LinkedInPerformanceReportInput, 'period'>) => Promise<reportingService.LinkedInPerformanceReport>,
) {
  return createTool({
    name,
    description,
    inputSchema: performanceReportSchema,
    handler: async (input) => {
      const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
      const { since, until } = defaultDateRange(lookbackDays);
      const rows = await insightsService.getInsights(connectionKey, {
        accountUrn: input.accountUrn,
        pivot: 'ACCOUNT',
        since,
        until,
      });
      return generate({
        accountName: input.accountName ?? input.accountUrn,
        insights: rows,
      });
    },
  });
}

export const dailyReportTool = createReportTool(
  'linkedin_daily_report',
  "Generates yesterday's performance report (spend/impressions/clicks/leads totals plus an AI narrative) for a LinkedIn ad account.",
  1,
  (input) => reportingService.generateDailyReport(input),
);

export const weeklyReportTool = createReportTool(
  'linkedin_weekly_report',
  'Generates the last 7 days performance report for a LinkedIn ad account.',
  7,
  (input) => reportingService.generateWeeklyReport(input),
);

export const monthlyReportTool = createReportTool(
  'linkedin_monthly_report',
  'Generates the last 30 days performance report for a LinkedIn ad account.',
  30,
  (input) => reportingService.generateMonthlyReport(input),
);

const creativeScoreSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  creativeUrn: z.string().describe('Creative URN (from linkedin_list_creatives).'),
});

export const creativeScoreTool = createTool({
  name: 'linkedin_creative_score',
  description: 'Computes a deterministic 0-100 structural quality score for a creative (commentary length, headline, CTA, landing page) with an AI-written critique.',
  inputSchema: creativeScoreSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    const creative = await creativesService.getCreative(connectionKey, input.creativeUrn);
    return reportingService.computeCreativeScore(creative);
  },
});

export const aiTools = [
  generateAdCopyTool,
  generateHeadlinesTool,
  generateDescriptionsTool,
  generateCtaTool,
  recommendBudgetTool,
  recommendBidTool,
  recommendTargetingTool,
  competitorAnalysisTool,
  campaignHealthScoreTool,
  dailyReportTool,
  weeklyReportTool,
  monthlyReportTool,
  creativeScoreTool,
];
