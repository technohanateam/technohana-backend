import { completeText } from './ai.service.js';
import type { LinkedInCreative, LinkedInInsightsRow } from '../types/linkedin.types.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface CampaignScoreSignals {
  avgCtr: number;
  avgCpl: number;
  leadConversionRate: number;
  ctrScore: number;
  leadConversionScore: number;
  cplScore: number;
}

/**
 * Deterministic 0-100 health score derived from CTR, click-to-lead conversion
 * rate, and (when lead data exists) CPL - weighted so the score is
 * reproducible and auditable rather than an LLM guess. AI is used only to
 * narrate the result. Benchmarks are scaled to LinkedIn's typically lower CTR
 * (~0.4-0.65%) compared to consumer ad platforms.
 */
function computeScore(rows: LinkedInInsightsRow[]): { score: number; signals: CampaignScoreSignals | Record<string, never> } {
  if (rows.length === 0) return { score: 0, signals: {} };

  const avgCtr = rows.reduce((sum, row) => sum + row.ctr, 0) / rows.length;
  const totalClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const totalSpend = rows.reduce((sum, row) => sum + row.costInLocalCurrency, 0);
  const totalLeads = rows.reduce((sum, row) => sum + (row.oneClickLeads ?? 0), 0);
  const leadConversionRate = totalClicks > 0 ? totalLeads / totalClicks : 0;
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

  // CTR: 0% -> 0 pts, 0.6%+ -> 40 pts (LinkedIn's typical "good" CTR ballpark).
  const ctrScore = clamp((avgCtr / 0.006) * 40, 0, 40);
  // Click-to-lead conversion: 0% -> 0 pts, 10%+ -> 30 pts.
  const leadConversionScore = clamp((leadConversionRate / 0.1) * 30, 0, 30);
  // CPL: only scored when lead data exists; otherwise a neutral midpoint.
  const cplScore = totalLeads > 0 ? clamp(30 - clamp((avgCpl - 50) / 5, 0, 30), 0, 30) : 15;

  const score = Math.round(ctrScore + leadConversionScore + cplScore);
  return { score, signals: { avgCtr, avgCpl, leadConversionRate, ctrScore, leadConversionScore, cplScore } };
}

function gradeFromScore(score: number): LinkedInCampaignHealthScore['grade'] {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

export interface LinkedInCampaignHealthInput {
  campaignName: string;
  objectiveType: string;
  insights: LinkedInInsightsRow[];
}

export interface LinkedInCampaignHealthScore {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  signals: CampaignScoreSignals | Record<string, never>;
  summary: string;
}

/** campaign_health_score: deterministic score + AI-written narrative and next action. */
export async function computeCampaignHealthScore(input: LinkedInCampaignHealthInput): Promise<LinkedInCampaignHealthScore> {
  const { score, signals } = computeScore(input.insights);
  const grade = gradeFromScore(score);

  const summary = await completeText({
    system:
      'You are a LinkedIn Ads performance analyst. Write a concise 2-3 sentence summary of campaign health and one concrete next action, given a numeric health score and its underlying signals. No markdown formatting.',
    prompt: `Campaign: ${input.campaignName}\nObjective: ${input.objectiveType}\nHealth score: ${score}/100 (${grade})\nSignals: ${JSON.stringify(signals)}`,
    maxTokens: 250,
  });

  return { score, grade, signals, summary };
}

export type LinkedInReportPeriod = 'daily' | 'weekly' | 'monthly';

export interface LinkedInPerformanceReportInput {
  period: LinkedInReportPeriod;
  accountName: string;
  insights: LinkedInInsightsRow[];
}

export interface LinkedInPerformanceReportTotals {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
}

export interface LinkedInPerformanceReport {
  period: LinkedInReportPeriod;
  totals: LinkedInPerformanceReportTotals;
  narrative: string;
}

function aggregateTotals(rows: LinkedInInsightsRow[]): LinkedInPerformanceReportTotals {
  return rows.reduce<LinkedInPerformanceReportTotals>(
    (acc, row) => ({
      spend: acc.spend + row.costInLocalCurrency,
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      leads: acc.leads + (row.oneClickLeads ?? 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0 },
  );
}

/** Shared implementation behind daily_report / weekly_report / monthly_report. */
export async function generatePerformanceReport(input: LinkedInPerformanceReportInput): Promise<LinkedInPerformanceReport> {
  const totals = aggregateTotals(input.insights);

  const narrative = await completeText({
    system: `You are a LinkedIn Ads reporting analyst. Write a ${input.period} performance report as 3-5 sentences of plain-English narrative covering trend direction and one recommendation. No markdown formatting.`,
    prompt: `Account: ${input.accountName}\nPeriod: ${input.period}\nTotals: ${JSON.stringify(totals)}\nRow-level detail (${input.insights.length} rows): ${JSON.stringify(input.insights.slice(0, 20))}`,
    maxTokens: 350,
  });

  return { period: input.period, totals, narrative };
}

export function generateDailyReport(input: Omit<LinkedInPerformanceReportInput, 'period'>): Promise<LinkedInPerformanceReport> {
  return generatePerformanceReport({ ...input, period: 'daily' });
}

export function generateWeeklyReport(input: Omit<LinkedInPerformanceReportInput, 'period'>): Promise<LinkedInPerformanceReport> {
  return generatePerformanceReport({ ...input, period: 'weekly' });
}

export function generateMonthlyReport(input: Omit<LinkedInPerformanceReportInput, 'period'>): Promise<LinkedInPerformanceReport> {
  return generatePerformanceReport({ ...input, period: 'monthly' });
}

interface CreativeScoreSignals {
  commentaryLengthOk: boolean;
  headlinePresentAndSized: boolean;
  ctaPresent: boolean;
  landingPageIsHttps: boolean;
}

export interface LinkedInCreativeScore {
  score: number;
  signals: CreativeScoreSignals;
  summary: string;
}

/**
 * Deterministic 0-100 structural quality score for a creative (commentary
 * length, headline presence/length, CTA presence, landing page scheme) - AI
 * narrates improvement suggestions on top of the already-computed score.
 */
export async function computeCreativeScore(creative: LinkedInCreative): Promise<LinkedInCreativeScore> {
  const commentaryLengthOk = !!creative.commentary && creative.commentary.length <= 150;
  const headlinePresentAndSized = !!creative.headline && creative.headline.length <= 70;
  const ctaPresent = !!creative.callToActionLabel;
  const landingPageIsHttps = !!creative.landingPageUrl && creative.landingPageUrl.startsWith('https://');

  const signals: CreativeScoreSignals = { commentaryLengthOk, headlinePresentAndSized, ctaPresent, landingPageIsHttps };
  const score =
    (commentaryLengthOk ? 30 : 0) + (headlinePresentAndSized ? 25 : 0) + (ctaPresent ? 20 : 0) + (landingPageIsHttps ? 25 : 0);

  const summary = await completeText({
    system:
      'You are a LinkedIn Ads creative quality analyst. Write a concise 2-3 sentence critique and one concrete improvement, given a structural quality score and its underlying checks. No markdown formatting.',
    prompt: `Creative type: ${creative.type}\nCommentary: ${creative.commentary ?? '(none)'}\nHeadline: ${creative.headline ?? '(none)'}\nCTA: ${creative.callToActionLabel ?? '(none)'}\nLanding page: ${creative.landingPageUrl ?? '(none)'}\nStructural score: ${score}/100\nChecks: ${JSON.stringify(signals)}`,
    maxTokens: 250,
  });

  return { score, signals, summary };
}
