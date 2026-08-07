import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedInCreative, LinkedInInsightsRow } from '../../../src/types/linkedin.types.js';

const mockCompleteText = vi.fn().mockResolvedValue('AI narrative summary.');

vi.mock('../../../src/services/ai.service.js', () => ({
  completeText: mockCompleteText,
}));

const { computeCampaignHealthScore, computeCreativeScore, generateDailyReport, generateWeeklyReport, generateMonthlyReport } =
  await import('../../../src/services/linkedinReporting.service.js');

function row(overrides: Partial<LinkedInInsightsRow> = {}): LinkedInInsightsRow {
  return {
    dateRangeStart: '2026-01-01',
    dateRangeEnd: '2026-01-01',
    accountUrn: 'urn:li:sponsoredAccount:1',
    impressions: 10000,
    clicks: 60,
    costInLocalCurrency: 300,
    currency: 'USD',
    ctr: 0.006,
    cpc: 5,
    cpm: 30,
    oneClickLeads: 6,
    ...overrides,
  };
}

function creative(overrides: Partial<LinkedInCreative> = {}): LinkedInCreative {
  return {
    urn: 'urn:li:sponsoredCreative:1',
    id: '1',
    accountUrn: 'urn:li:sponsoredAccount:1',
    campaignUrn: 'urn:li:sponsoredCampaign:1',
    type: 'SINGLE_IMAGE',
    status: 'DRAFT',
    commentary: 'Short and compelling intro text',
    headline: 'A short headline',
    callToActionLabel: 'LEARN_MORE',
    landingPageUrl: 'https://example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModifiedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('linkedinReporting.service', () => {
  beforeEach(() => {
    mockCompleteText.mockClear();
  });

  it('scores an empty insights window as 0', async () => {
    const result = await computeCampaignHealthScore({ campaignName: 'Empty', objectiveType: 'LEAD_GENERATION', insights: [] });
    expect(result.score).toBe(0);
    expect(result.grade).toBe('poor');
  });

  it('scores strong performance (good CTR, healthy lead conversion, efficient CPL) as excellent', async () => {
    const rows = [row({ ctr: 0.006, clicks: 100, oneClickLeads: 15, costInLocalCurrency: 500 })];
    const result = await computeCampaignHealthScore({ campaignName: 'Strong', objectiveType: 'LEAD_GENERATION', insights: rows });
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.grade).toBe('excellent');
  });

  it('penalizes poor click-to-lead conversion even with a decent CTR', async () => {
    const strong = [row({ ctr: 0.006, clicks: 100, oneClickLeads: 15 })];
    const weak = [row({ ctr: 0.006, clicks: 100, oneClickLeads: 1 })];
    const strongResult = await computeCampaignHealthScore({ campaignName: 'A', objectiveType: 'LEAD_GENERATION', insights: strong });
    const weakResult = await computeCampaignHealthScore({ campaignName: 'B', objectiveType: 'LEAD_GENERATION', insights: weak });
    expect(weakResult.score).toBeLessThan(strongResult.score);
  });

  it('includes the AI-generated narrative summary', async () => {
    const result = await computeCampaignHealthScore({ campaignName: 'X', objectiveType: 'LEAD_GENERATION', insights: [row()] });
    expect(result.summary).toBe('AI narrative summary.');
    expect(mockCompleteText).toHaveBeenCalledTimes(1);
  });

  it('aggregates totals correctly across multiple rows', async () => {
    const rows = [row({ costInLocalCurrency: 100, impressions: 1000, clicks: 10, oneClickLeads: 2 }), row({ costInLocalCurrency: 50, impressions: 500, clicks: 5, oneClickLeads: 1 })];
    const report = await generateDailyReport({ accountName: 'Acme', insights: rows });
    expect(report.totals).toEqual({ spend: 150, impressions: 1500, clicks: 15, leads: 3 });
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

  it('scores a well-formed creative highly', async () => {
    const result = await computeCreativeScore(creative());
    expect(result.score).toBe(100);
    expect(result.signals).toEqual({
      commentaryLengthOk: true,
      headlinePresentAndSized: true,
      ctaPresent: true,
      landingPageIsHttps: true,
    });
  });

  it('penalizes a creative missing a CTA and headline', async () => {
    const result = await computeCreativeScore(creative({ headline: undefined, callToActionLabel: undefined }));
    expect(result.score).toBe(55);
    expect(result.signals.headlinePresentAndSized).toBe(false);
    expect(result.signals.ctaPresent).toBe(false);
  });

  it('penalizes an http (non-https) landing page', async () => {
    const result = await computeCreativeScore(creative({ landingPageUrl: 'http://example.com' }));
    expect(result.signals.landingPageIsHttps).toBe(false);
    expect(result.score).toBe(75);
  });
});
