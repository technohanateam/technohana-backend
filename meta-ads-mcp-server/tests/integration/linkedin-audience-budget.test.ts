import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mswServer } from '../setup.js';
import { deleteToken, storeToken } from '../../src/auth/linkedinTokenManager.js';
import { LINKEDIN_API_BASE_URL } from '../../src/config/constants.js';
import { initMcpSession, callTool, parseMcpResponse } from './mcpTestHelpers.js';

const CONNECTION_KEY = 'urn:li:organization:linkedin-audience-budget-test';
const ACCOUNT_URN = 'urn:li:sponsoredAccount:333';
const CAMPAIGN_URN = 'urn:li:sponsoredCampaign:444';

const FULL_CAMPAIGN = {
  id: 444,
  account: ACCOUNT_URN,
  campaignGroup: 'urn:li:sponsoredCampaignGroup:111',
  name: 'Existing Campaign',
  objectiveType: 'LEAD_GENERATION',
  type: 'SPONSORED_UPDATES',
  status: 'ACTIVE',
  costType: 'CPC',
  dailyBudget: { amount: '75', currencyCode: 'USD' },
  createdAt: 1700000000000,
  lastModifiedAt: 1700000000000,
};

interface CallToolResultBody {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

describe('LinkedIn audience & budget tools (real HTTP + MCP stack, LinkedIn API mocked)', () => {
  beforeEach(async () => {
    await storeToken({
      key: CONNECTION_KEY,
      accessToken: 'seeded-linkedin-access-token',
      refreshToken: 'seeded-refresh-token',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: ['rw_ads'],
      organizationUrn: CONNECTION_KEY,
    });
  });

  afterEach(async () => {
    await deleteToken(CONNECTION_KEY);
  });

  it('estimates audience size for a targeting spec', async () => {
    mswServer.use(
      http.get(`${LINKEDIN_API_BASE_URL}/audienceCounts`, ({ request: req }) => {
        expect(new URL(req.url).searchParams.get('account')).toBe(ACCOUNT_URN);
        return HttpResponse.json({ value: { start: 50000, end: 120000 } });
      }),
    );

    const session = await initMcpSession('viewer');
    const res = await callTool(session, 'linkedin_estimate_audience', {
      connectionKey: CONNECTION_KEY,
      accountUrn: ACCOUNT_URN,
      targeting: { industries: ['urn:li:industry:4'], jobFunctions: ['urn:li:function:8'] },
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    const estimate = JSON.parse(body.result!.content[0].text);
    expect(estimate).toMatchObject({ audienceCountLow: 50000, audienceCountHigh: 120000 });
  });

  it('updates a campaign budget via a PATCH partial update', async () => {
    let capturedBody: unknown;
    mswServer.use(
      http.get(`${LINKEDIN_API_BASE_URL}/adCampaigns/444`, () => HttpResponse.json(FULL_CAMPAIGN)),
      http.patch(`${LINKEDIN_API_BASE_URL}/adCampaigns/444`, async ({ request: req }) => {
        capturedBody = await req.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'linkedin_update_budget', {
      connectionKey: CONNECTION_KEY,
      campaignUrn: CAMPAIGN_URN,
      dailyBudgetAmount: 100,
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    expect(capturedBody).toEqual({ patch: { $set: { dailyBudget: { amount: '100', currencyCode: 'USD' } } } });
  });

  it('rejects update_budget when neither budget field is provided', async () => {
    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'linkedin_update_budget', {
      connectionKey: CONNECTION_KEY,
      campaignUrn: CAMPAIGN_URN,
    });
    expect(res.status).toBe(200);
    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBe(true);
  });

  it('updates a campaign bid', async () => {
    let capturedBody: unknown;
    mswServer.use(
      http.get(`${LINKEDIN_API_BASE_URL}/adCampaigns/444`, () => HttpResponse.json(FULL_CAMPAIGN)),
      http.patch(`${LINKEDIN_API_BASE_URL}/adCampaigns/444`, async ({ request: req }) => {
        capturedBody = await req.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'linkedin_update_bid', {
      connectionKey: CONNECTION_KEY,
      campaignUrn: CAMPAIGN_URN,
      unitCostAmount: 12.5,
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    expect(capturedBody).toEqual({ patch: { $set: { unitCost: { amount: '12.5', currencyCode: 'USD' } } } });
  });
});
