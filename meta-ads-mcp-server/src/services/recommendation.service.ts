import { completeJson } from './ai.service.js';
import type { MetaInsightsRow } from '../types/meta.types.js';

function summarizeInsights(rows: MetaInsightsRow[]): string {
  if (rows.length === 0) return 'No historical performance data available.';
  const totalSpend = rows.reduce((sum, row) => sum + row.spend, 0);
  const totalPurchases = rows.reduce((sum, row) => sum + (row.purchases ?? 0), 0);
  const avgCpa = totalPurchases > 0 ? totalSpend / totalPurchases : undefined;
  const avgCtr = rows.reduce((sum, row) => sum + row.ctr, 0) / rows.length;
  return `Rows: ${rows.length}, total spend: ${totalSpend.toFixed(2)}, total purchases: ${totalPurchases}, avg CPA: ${avgCpa?.toFixed(2) ?? 'n/a'}, avg CTR: ${avgCtr.toFixed(2)}%`;
}

export interface BudgetRecommendationInput {
  objective: string;
  historicalInsights: MetaInsightsRow[];
  targetDailyResults?: number;
  currency: string;
}

export interface BudgetRecommendation {
  recommendedDailyBudgetCents: number;
  reasoning: string;
  confidence: 'low' | 'medium' | 'high';
}

/** recommend_budget: a suggested daily budget grounded in real historical performance when available. */
export async function recommendBudget(input: BudgetRecommendationInput): Promise<BudgetRecommendation> {
  return completeJson<BudgetRecommendation>({
    system:
      'You are a Meta Ads budget strategist. Analyze the historical performance summary and recommend a daily budget in the smallest currency unit (cents). Confidence should be "low" whenever historical data is sparse or absent. Return JSON {"recommendedDailyBudgetCents": number, "reasoning": string, "confidence": "low"|"medium"|"high"}.',
    prompt: `Campaign objective: ${input.objective}\nCurrency: ${input.currency}\nTarget daily results: ${input.targetDailyResults ?? 'not specified'}\nHistorical performance: ${summarizeInsights(input.historicalInsights)}`,
    maxTokens: 400,
  });
}

export interface AudienceRecommendationInput {
  productOrService: string;
  objective: string;
  existingTargetingSummary?: string;
}

export interface AudienceRecommendation {
  ageMin: number;
  ageMax: number;
  genders: Array<1 | 2>;
  interestSuggestions: string[];
  reasoning: string;
}

/** recommend_audience: age range, gender, and interest targeting suggestions. */
export async function recommendAudience(input: AudienceRecommendationInput): Promise<AudienceRecommendation> {
  return completeJson<AudienceRecommendation>({
    system:
      'You are a Meta Ads audience strategist. Return JSON {"ageMin": number, "ageMax": number, "genders": number[] (1=male,2=female; include both for an all-genders audience), "interestSuggestions": string[] (Meta interest targeting keyword names), "reasoning": string}.',
    prompt: `Product/service: ${input.productOrService}\nObjective: ${input.objective}\nExisting targeting (if any): ${input.existingTargetingSummary ?? 'none'}`,
    maxTokens: 400,
  });
}

export interface BidRecommendationInput {
  objective: string;
  optimizationGoal: string;
  historicalInsights: MetaInsightsRow[];
  currency: string;
}

export interface BidRecommendation {
  bidStrategy: 'LOWEST_COST_WITHOUT_CAP' | 'LOWEST_COST_WITH_BID_CAP' | 'COST_CAP' | 'LOWEST_COST_WITH_MIN_ROAS';
  recommendedBidCapCents: number | null;
  reasoning: string;
}

/** recommend_bid: a suggested bid strategy (and cap, when applicable) from historical cost data. */
export async function recommendBid(input: BidRecommendationInput): Promise<BidRecommendation> {
  return completeJson<BidRecommendation>({
    system:
      'You are a Meta Ads bidding strategist. Return JSON {"bidStrategy": one of "LOWEST_COST_WITHOUT_CAP"|"LOWEST_COST_WITH_BID_CAP"|"COST_CAP"|"LOWEST_COST_WITH_MIN_ROAS", "recommendedBidCapCents": number or null, "reasoning": string}.',
    prompt: `Objective: ${input.objective}\nOptimization goal: ${input.optimizationGoal}\nCurrency: ${input.currency}\nHistorical performance: ${summarizeInsights(input.historicalInsights)}`,
    maxTokens: 350,
  });
}

export interface CampaignStructureRecommendationInput {
  productOrService: string;
  objective: string;
  monthlyBudgetCents: number;
  currency: string;
}

export interface CampaignStructureRecommendation {
  adSetCount: number;
  adSetBreakdown: Array<{ name: string; audienceFocus: string; budgetSharePercent: number }>;
  reasoning: string;
}

/** recommend_campaign_structure: how to split one campaign's budget across ad sets. */
export async function recommendCampaignStructure(
  input: CampaignStructureRecommendationInput,
): Promise<CampaignStructureRecommendation> {
  return completeJson<CampaignStructureRecommendation>({
    system:
      'You are a Meta Ads account structure strategist. Return JSON {"adSetCount": number, "adSetBreakdown": [{"name": string, "audienceFocus": string, "budgetSharePercent": number}], "reasoning": string}. budgetSharePercent values must sum to 100.',
    prompt: `Product/service: ${input.productOrService}\nObjective: ${input.objective}\nMonthly budget: ${(input.monthlyBudgetCents / 100).toFixed(2)} ${input.currency}`,
    maxTokens: 500,
  });
}

export interface CreativeRecommendationInput {
  productOrService: string;
  objective: string;
  availableAssetTypes: Array<'image' | 'video'>;
}

export interface CreativeRecommendation {
  recommendedFormat: 'SINGLE_IMAGE' | 'CAROUSEL' | 'VIDEO' | 'COLLECTION' | 'REELS' | 'STORIES';
  reasoning: string;
  creativeTips: string[];
}

/** recommend_creative: the best-fit ad format given the objective and available assets. */
export async function recommendCreative(input: CreativeRecommendationInput): Promise<CreativeRecommendation> {
  return completeJson<CreativeRecommendation>({
    system:
      'You are a Meta Ads creative strategist. Return JSON {"recommendedFormat": one of "SINGLE_IMAGE"|"CAROUSEL"|"VIDEO"|"COLLECTION"|"REELS"|"STORIES", "reasoning": string, "creativeTips": string[]}.',
    prompt: `Product/service: ${input.productOrService}\nObjective: ${input.objective}\nAvailable asset types: ${input.availableAssetTypes.join(', ')}`,
    maxTokens: 400,
  });
}
