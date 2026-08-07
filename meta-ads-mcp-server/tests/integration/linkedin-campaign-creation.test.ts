import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mswServer } from '../setup.js';
import { deleteToken, storeToken } from '../../src/auth/linkedinTokenManager.js';
import { LINKEDIN_API_BASE_URL } from '../../src/config/constants.js';
import { initMcpSession, callTool, parseMcpResponse } from './mcpTestHelpers.js';

const CONNECTION_KEY = 'urn:li:organization:linkedin-campaign-test';

const FULL_CAMPAIGN = {
  id: 555,
  account: 'urn:li:sponsoredAccount:999',
  campaignGroup: 'urn:li:sponsoredCampaignGroup:111',
  name: 'Q3 Lead Gen',
  objectiveType: 'LEAD_GENERATION',
  type: 'SPONSORED_UPDATES',
  status: 'DRAFT',
  costType: 'CPC',
  dailyBudget: { amount: '50', currencyCode: 'USD' },
  createdAt: 1700000000000,
  lastModifiedAt: 1700000000000,
};

interface CallToolResultBody {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

describe('LinkedIn campaign tools (real HTTP + MCP stack, LinkedIn API mocked)', () => {
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

  it('creates a campaign (POST + x-restli-id) and returns the full, freshly-fetched object', async () => {
    let capturedCreateBody: unknown;

    mswServer.use(
      http.post(`${LINKEDIN_API_BASE_URL}/adCampaigns`, async ({ request: req }) => {
        expect(req.headers.get('Authorization')).toBe('Bearer seeded-linkedin-access-token');
        capturedCreateBody = await req.json();
        return new HttpResponse(null, { status: 201, headers: { 'x-restli-id': '555' } });
      }),
      http.get(`${LINKEDIN_API_BASE_URL}/adCampaigns/555`, () => HttpResponse.json(FULL_CAMPAIGN)),
    );

    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'linkedin_create_campaign', {
      connectionKey: CONNECTION_KEY,
      accountUrn: 'urn:li:sponsoredAccount:999',
      campaignGroupUrn: 'urn:li:sponsoredCampaignGroup:111',
      name: 'Q3 Lead Gen',
      objectiveType: 'LEAD_GENERATION',
      type: 'SPONSORED_UPDATES',
      costType: 'CPC',
      dailyBudgetAmount: 50,
      currency: 'USD',
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    const campaign = JSON.parse(body.result!.content[0].text);
    expect(campaign).toMatchObject({
      id: '555',
      accountUrn: 'urn:li:sponsoredAccount:999',
      name: 'Q3 Lead Gen',
      objectiveType: 'LEAD_GENERATION',
      status: 'DRAFT',
      dailyBudgetAmount: 50,
    });

    expect((capturedCreateBody as { status: string }).status).toBe('DRAFT');
    expect((capturedCreateBody as { name: string }).name).toBe('Q3 Lead Gen');
  });

  it('defaults new campaigns to DRAFT status even when not specified', async () => {
    mswServer.use(
      http.post(`${LINKEDIN_API_BASE_URL}/adCampaigns`, () => new HttpResponse(null, { status: 201, headers: { 'x-restli-id': '555' } })),
      http.get(`${LINKEDIN_API_BASE_URL}/adCampaigns/555`, () => HttpResponse.json(FULL_CAMPAIGN)),
    );

    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'linkedin_create_campaign', {
      connectionKey: CONNECTION_KEY,
      accountUrn: 'urn:li:sponsoredAccount:999',
      campaignGroupUrn: 'urn:li:sponsoredCampaignGroup:111',
      name: 'Q3 Lead Gen',
      objectiveType: 'LEAD_GENERATION',
      type: 'SPONSORED_UPDATES',
      costType: 'CPC',
      currency: 'USD',
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    const campaign = JSON.parse(body.result!.content[0].text);
    expect(campaign.status).toBe('DRAFT');
  });

  it('rejects an invalid objective before any HTTP call is made', async () => {
    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'linkedin_create_campaign', {
      connectionKey: CONNECTION_KEY,
      accountUrn: 'urn:li:sponsoredAccount:999',
      campaignGroupUrn: 'urn:li:sponsoredCampaignGroup:111',
      name: 'Bad',
      objectiveType: 'NOT_A_REAL_OBJECTIVE',
      type: 'SPONSORED_UPDATES',
      costType: 'CPC',
      currency: 'USD',
    });
    // MSW would throw on an unhandled request if this leaked through to a real call.
    expect(res.status).toBe(200);
    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBe(true);
  });

  it('pauses a campaign via a PATCH partial update', async () => {
    let capturedPatchBody: unknown;
    mswServer.use(
      http.get(`${LINKEDIN_API_BASE_URL}/adCampaigns/555`, () => HttpResponse.json(FULL_CAMPAIGN)),
      http.patch(`${LINKEDIN_API_BASE_URL}/adCampaigns/555`, async ({ request: req }) => {
        capturedPatchBody = await req.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'linkedin_pause_campaign', {
      connectionKey: CONNECTION_KEY,
      campaignUrn: 'urn:li:sponsoredCampaign:555',
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    expect(capturedPatchBody).toEqual({ patch: { $set: { status: 'PAUSED' } } });
  });

  it('denies a viewer-role attempt to create a campaign (RBAC enforced)', async () => {
    const session = await initMcpSession('viewer');
    const res = await callTool(session, 'linkedin_create_campaign', {
      connectionKey: CONNECTION_KEY,
      accountUrn: 'urn:li:sponsoredAccount:999',
      campaignGroupUrn: 'urn:li:sponsoredCampaignGroup:111',
      name: 'Should Fail',
      objectiveType: 'LEAD_GENERATION',
      type: 'SPONSORED_UPDATES',
      costType: 'CPC',
      currency: 'USD',
    });
    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0].text).toMatch(/not permitted/);
  });
});
