import { completeJson } from './ai.service.js';
import type { LinkedInInsightsRow } from '../types/linkedin.types.js';

function summarizeInsights(rows: LinkedInInsightsRow[]): string {
  if (rows.length === 0) return 'No historical performance data available.';
  const totalSpend = rows.reduce((sum, row) => sum + row.costInLocalCurrency, 0);
  const totalLeads = rows.reduce((sum, row) => sum + (row.oneClickLeads ?? 0), 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : undefined;
  const avgCtr = rows.reduce((sum, row) => sum + row.ctr, 0) / rows.length;
  return `Rows: ${rows.length}, total spend: ${totalSpend.toFixed(2)}, total one-click leads: ${totalLeads}, avg CPL: ${avgCpl?.toFixed(2) ?? 'n/a'}, avg CTR: ${(avgCtr * 100).toFixed(2)}%`;
}

export interface LinkedInBudgetRecommendationInput {
  objectiveType: string;
  historicalInsights: LinkedInInsightsRow[];
  targetDailyResults?: number;
  currency: string;
}

export interface LinkedInBudgetRecommendation {
  recommendedDailyBudget: number;
  reasoning: string;
  confidence: 'low' | 'medium' | 'high';
}

/** recommend_budget: a suggested daily budget grounded in real historical performance when available. */
export async function recommendBudget(input: LinkedInBudgetRecommendationInput): Promise<LinkedInBudgetRecommendation> {
  return completeJson<LinkedInBudgetRecommendation>({
    system:
      'You are a LinkedIn Ads budget strategist. Analyze the historical performance summary and recommend a daily budget in whole currency units (not cents). Confidence should be "low" whenever historical data is sparse or absent. Return JSON {"recommendedDailyBudget": number, "reasoning": string, "confidence": "low"|"medium"|"high"}.',
    prompt: `Campaign objective: ${input.objectiveType}\nCurrency: ${input.currency}\nTarget daily results: ${input.targetDailyResults ?? 'not specified'}\nHistorical performance: ${summarizeInsights(input.historicalInsights)}`,
    maxTokens: 400,
  });
}

export interface LinkedInBidRecommendationInput {
  objectiveType: string;
  costType: string;
  historicalInsights: LinkedInInsightsRow[];
  currency: string;
}

export interface LinkedInBidRecommendation {
  recommendedUnitCost: number;
  reasoning: string;
  confidence: 'low' | 'medium' | 'high';
}

/** recommend_bid: a suggested bid (unit cost) amount grounded in historical cost data. */
export async function recommendBid(input: LinkedInBidRecommendationInput): Promise<LinkedInBidRecommendation> {
  return completeJson<LinkedInBidRecommendation>({
    system:
      'You are a LinkedIn Ads bidding strategist. Analyze the historical performance summary and recommend a bid (unit cost) amount in whole currency units (not cents), appropriate for the campaign\'s cost type (CPC/CPM/CPV). Confidence should be "low" whenever historical data is sparse or absent. Return JSON {"recommendedUnitCost": number, "reasoning": string, "confidence": "low"|"medium"|"high"}.',
    prompt: `Objective: ${input.objectiveType}\nCost type: ${input.costType}\nCurrency: ${input.currency}\nHistorical performance: ${summarizeInsights(input.historicalInsights)}`,
    maxTokens: 350,
  });
}

export interface LinkedInTargetingRecommendationInput {
  productOrService: string;
  objective: string;
  existingTargetingSummary?: string;
}

export interface LinkedInTargetingRecommendation {
  suggestedIndustries: string[];
  suggestedJobFunctions: string[];
  suggestedJobSeniorities: string[];
  suggestedCompanySizes: string[];
  reasoning: string;
  note: string;
}

/**
 * recommend_targeting: human-readable facet-category suggestions (industries,
 * job functions, seniorities, company sizes) for the campaign. Returns
 * suggested category names, not resolved LinkedIn facet URNs - those must be
 * looked up against LinkedIn's live adTargetingFacets before being passed to
 * linkedin_update_targeting or linkedin_create_campaign.
 */
export async function recommendTargeting(input: LinkedInTargetingRecommendationInput): Promise<LinkedInTargetingRecommendation> {
  const result = await completeJson<Omit<LinkedInTargetingRecommendation, 'note'>>({
    system:
      'You are a LinkedIn Ads audience strategist. Return JSON {"suggestedIndustries": string[], "suggestedJobFunctions": string[], "suggestedJobSeniorities": string[], "suggestedCompanySizes": string[], "reasoning": string} with category names a B2B advertiser would recognize (e.g. "Software Development", "Marketing", "Director", "51-200 employees").',
    prompt: `Product/service: ${input.productOrService}\nObjective: ${input.objective}\nExisting targeting (if any): ${input.existingTargetingSummary ?? 'none'}`,
    maxTokens: 400,
  });

  return {
    ...result,
    note: 'These are suggested category names, not resolved LinkedIn facet URNs. Look each one up against LinkedIn\'s targeting facets before passing it to linkedin_update_targeting.',
  };
}

export interface CompetitorAnalysisInput {
  productOrService: string;
  competitorNameOrDescription: string;
  objective: string;
}

export interface CompetitorAnalysis {
  competitiveAdvantages: string[];
  messagingGapsToExploit: string[];
  recommendedPositioning: string;
}

/** competitor_analysis: a brief-grounded competitive positioning analysis for a LinkedIn campaign. */
export async function analyzeCompetitor(input: CompetitorAnalysisInput): Promise<CompetitorAnalysis> {
  return completeJson<CompetitorAnalysis>({
    system:
      'You are a B2B competitive positioning strategist advising a LinkedIn Ads campaign. Return JSON {"competitiveAdvantages": string[], "messagingGapsToExploit": string[], "recommendedPositioning": string}. Be specific and grounded in the brief given - do not fabricate facts about the named competitor beyond what a reasonable market analysis would infer.',
    prompt: `Our product/service: ${input.productOrService}\nCompetitor: ${input.competitorNameOrDescription}\nCampaign objective: ${input.objective}`,
    maxTokens: 500,
  });
}
