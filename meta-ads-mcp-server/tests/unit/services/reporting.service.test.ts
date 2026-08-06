import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetaInsightsRow } from '../../../src/types/meta.types.js';

const mockCompleteText = vi.fn().mockResolvedValue('AI narrative summary.');

vi.mock('../../../src/services/ai.service.js', () => ({
  completeText: mockCompleteText,
}));

const { computeCampaignHealthScore, generateDailyReport, generateWeeklyReport, generateMonthlyReport } = await import(
  '../../../src/services/reporting.service.js'
);

function row(overrides: Partial<MetaInsightsRow> = {}): MetaInsightsRow {
  return {
    dateStart: '2026-01-01',
    dateStop: '2026-01-01',
    accountId: 'act_1',
    spend: 100,
    impressions: 1000,
    reach: 900,
    clicks: 20,
    ctr: 2,
    cpc: 5,
    cpm: 100,
    frequency: 1.2,
    purchases: 5,
    ...overrides,
  };
}

describe('reporting.service', () => {
  beforeEach(() => {
    mockCompleteText.mockClear();
  });

  it('scores an empty insights window as 0', async () => {
    const result = await computeCampaignHealthScore({ campaignName: 'Empty', objective: 'OUTCOME_TRAFFIC', insights: [] });
    expect(result.score).toBe(0);
    expect(result.grade).toBe('poor');
  });

  it('scores strong performance (high CTR, healthy frequency, low CPA) as excellent', async () => {
    const rows = [row({ ctr: 4, frequency: 1.5, spend: 100, purchases: 10 })]; // CPA = 10
    const result = await computeCampaignHealthScore({ campaignName: 'Strong', objective: 'OUTCOME_SALES', insights: rows });
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.grade).toBe('excellent');
  });

  it('penalizes ad fatigue (high frequency) even with a decent CTR', async () => {
    const healthy = [row({ ctr: 2, frequency: 1.5 })];
    const fatigued = [row({ ctr: 2, frequency: 8 })];
    const healthyResult = await computeCampaignHealthScore({ campaignName: 'A', objective: 'OUTCOME_TRAFFIC', insights: healthy });
    const fatiguedResult = await computeCampaignHealthScore({ campaignName: 'B', objective: 'OUTCOME_TRAFFIC', insights: fatigued });
    expect(fatiguedResult.score).toBeLessThan(healthyResult.score);
  });

  it('includes the AI-generated narrative summary', async () => {
    const result = await computeCampaignHealthScore({ campaignName: 'X', objective: 'OUTCOME_TRAFFIC', insights: [row()] });
    expect(result.summary).toBe('AI narrative summary.');
    expect(mockCompleteText).toHaveBeenCalledTimes(1);
  });

  it('aggregates totals correctly across multiple rows', async () => {
    const rows = [row({ spend: 100, impressions: 1000, clicks: 10, purchases: 2 }), row({ spend: 50, impressions: 500, clicks: 5, purchases: 1 })];
    const report = await generateDailyReport({ accountName: 'Acme', insights: rows });
    expect(report.totals).toEqual({ spend: 150, impressions: 1500, clicks: 15, purchases: 3 });
  });

  it('sets the correct period for each report type (regression: period must not leak across report kinds)', async () => {
    const rows = [row()];
    const daily = await generateDailyReport({ accountName: 'Acme', insights: rows });
    const weekly = await generateWeeklyReport({ accountName: 'Acme', insights: rows });
    const monthly = await generateMonthlyReport({ accountName: 'Acme', insights: rows });
    expect(daily.period).toBe('daily');
    expect(weekly.period).toBe('weekly');
    expect(monthly.period).toBe('monthly');
  });
});
