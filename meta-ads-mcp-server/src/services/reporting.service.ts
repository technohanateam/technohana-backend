import { completeText } from './ai.service.js';
import type { MetaInsightsRow } from '../types/meta.types.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface ScoreBreakdown {
  avgCtr: number;
  avgFrequency: number;
  cpa: number;
  ctrScore: number;
  frequencyScore: number;
  cpaScore: number;
}

/**
 * Deterministic 0-100 health score derived from CTR, frequency, and (when
 * purchase data exists) CPA - weighted so the score is reproducible and
 * auditable rather than an LLM guess. AI is used only to narrate the result.
 */
function computeScore(rows: MetaInsightsRow[]): { score: number; signals: ScoreBreakdown | Record<string, never> } {
  if (rows.length === 0) return { score: 0, signals: {} };

  const avgCtr = rows.reduce((sum, row) => sum + row.ctr, 0) / rows.length;
  const avgFrequency = rows.reduce((sum, row) => sum + row.frequency, 0) / rows.length;
  const totalSpend = rows.reduce((sum, row) => sum + row.spend, 0);
  const totalPurchases = rows.reduce((sum, row) => sum + (row.purchases ?? 0), 0);
  const cpa = totalPurchases > 0 ? totalSpend / totalPurchases : undefined;

  // CTR: 0% -> 0 pts, 3%+ -> 40 pts.
  const ctrScore = clamp((avgCtr / 3) * 40, 0, 40);
  // Frequency: 1-2 is ideal (30 pts); penalize ad fatigue above 2.
  const frequencyScore = clamp(30 - Math.max(0, avgFrequency - 2) * 10, 0, 30);
  // CPA: only scored when purchase data exists; otherwise a neutral midpoint.
  const cpaScore = cpa !== undefined ? clamp(30 - clamp((cpa - 20) / 2, 0, 30), 0, 30) : 15;

  const score = Math.round(ctrScore + frequencyScore + cpaScore);
  return { score, signals: { avgCtr, avgFrequency, cpa: cpa ?? -1, ctrScore, frequencyScore, cpaScore } };
}

function gradeFromScore(score: number): CampaignHealthScore['grade'] {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

export interface CampaignHealthInput {
  campaignName: string;
  objective: string;
  insights: MetaInsightsRow[];
}

export interface CampaignHealthScore {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  signals: ScoreBreakdown | Record<string, never>;
  summary: string;
}

/** campaign_health_score: deterministic score + AI-written narrative and next action. */
export async function computeCampaignHealthScore(input: CampaignHealthInput): Promise<CampaignHealthScore> {
  const { score, signals } = computeScore(input.insights);
  const grade = gradeFromScore(score);

  const summary = await completeText({
    system:
      'You are a Meta Ads performance analyst. Write a concise 2-3 sentence summary of campaign health and one concrete next action, given a numeric health score and its underlying signals. No markdown formatting.',
    prompt: `Campaign: ${input.campaignName}\nObjective: ${input.objective}\nHealth score: ${score}/100 (${grade})\nSignals: ${JSON.stringify(signals)}`,
    maxTokens: 250,
  });

  return { score, grade, signals, summary };
}

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

export interface PerformanceReportInput {
  period: ReportPeriod;
  accountName: string;
  insights: MetaInsightsRow[];
}

export interface PerformanceReportTotals {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
}

export interface PerformanceReport {
  period: ReportPeriod;
  totals: PerformanceReportTotals;
  narrative: string;
}

function aggregateTotals(rows: MetaInsightsRow[]): PerformanceReportTotals {
  return rows.reduce<PerformanceReportTotals>(
    (acc, row) => ({
      spend: acc.spend + row.spend,
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      purchases: acc.purchases + (row.purchases ?? 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, purchases: 0 },
  );
}

/** Shared implementation behind daily_report / weekly_report / monthly_report. */
export async function generatePerformanceReport(input: PerformanceReportInput): Promise<PerformanceReport> {
  const totals = aggregateTotals(input.insights);

  const narrative = await completeText({
    system: `You are a Meta Ads reporting analyst. Write a ${input.period} performance report as 3-5 sentences of plain-English narrative covering trend direction and one recommendation. No markdown formatting.`,
    prompt: `Account: ${input.accountName}\nPeriod: ${input.period}\nTotals: ${JSON.stringify(totals)}\nRow-level detail (${input.insights.length} rows): ${JSON.stringify(input.insights.slice(0, 20))}`,
    maxTokens: 350,
  });

  return { period: input.period, totals, narrative };
}

export function generateDailyReport(input: Omit<PerformanceReportInput, 'period'>): Promise<PerformanceReport> {
  return generatePerformanceReport({ ...input, period: 'daily' });
}

export function generateWeeklyReport(input: Omit<PerformanceReportInput, 'period'>): Promise<PerformanceReport> {
  return generatePerformanceReport({ ...input, period: 'weekly' });
}

export function generateMonthlyReport(input: Omit<PerformanceReportInput, 'period'>): Promise<PerformanceReport> {
  return generatePerformanceReport({ ...input, period: 'monthly' });
}
