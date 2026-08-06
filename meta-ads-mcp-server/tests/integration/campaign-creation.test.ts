import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { mswServer } from '../setup.js';
import { storeToken } from '../../src/auth/tokenManager.js';
import { initMcpSession, callTool, parseMcpResponse } from './mcpTestHelpers.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const CONNECTION_KEY = 'campaign-test-connection';

const FULL_CAMPAIGN = {
  id: 'camp_1',
  account_id: '123',
  name: 'Summer Sale',
  objective: 'OUTCOME_TRAFFIC',
  status: 'PAUSED',
  daily_budget: '5000',
  bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  created_time: '2026-01-01T00:00:00+0000',
  updated_time: '2026-01-01T00:00:00+0000',
};

interface CallToolResultBody {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

describe('create_campaign (real HTTP + MCP stack, Meta API mocked)', () => {
  beforeEach(async () => {
    await storeToken({
      key: CONNECTION_KEY,
      accessToken: 'seeded-access-token',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: ['ads_management'],
      businessId: 'biz_seed',
    });
  });

  it('creates a campaign and returns the full, freshly-fetched object', async () => {
    let capturedCreateBody = '';
    let capturedCreateUrl = '';

    mswServer.use(
      http.post(`${GRAPH_BASE}/act_123/campaigns`, async ({ request: req }) => {
        capturedCreateUrl = req.url;
        capturedCreateBody = await req.text();
        return HttpResponse.json({ id: 'camp_1' });
      }),
      http.get(`${GRAPH_BASE}/camp_1`, ({ request: req }) => {
        expect(new URL(req.url).searchParams.get('access_token')).toBe('seeded-access-token');
        return HttpResponse.json(FULL_CAMPAIGN);
      }),
    );

    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'create_campaign', {
      connectionKey: CONNECTION_KEY,
      accountId: 'act_123',
      name: 'Summer Sale',
      objective: 'OUTCOME_TRAFFIC',
      dailyBudgetCents: 5000,
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    const campaign = JSON.parse(body.result!.content[0].text);
    expect(campaign).toMatchObject({
      id: 'camp_1',
      accountId: 'act_123',
      name: 'Summer Sale',
      objective: 'OUTCOME_TRAFFIC',
      status: 'PAUSED',
      dailyBudgetCents: 5000,
    });

    // Confirms the real token flow: the seeded access token actually reached
    // the Meta API call (as a query param, per client.ts), not just a mocked
    // shortcut.
    expect(new URL(capturedCreateUrl).searchParams.get('access_token')).toBe('seeded-access-token');
    const params = new URLSearchParams(capturedCreateBody);
    expect(params.get('name')).toBe('Summer Sale');
    expect(params.get('status')).toBe('PAUSED');
    expect(params.get('special_ad_categories')).toBe('[]');
  });

  it('defaults new campaigns to PAUSED status even when not specified', async () => {
    mswServer.use(
      http.post(`${GRAPH_BASE}/act_123/campaigns`, () => HttpResponse.json({ id: 'camp_1' })),
      http.get(`${GRAPH_BASE}/camp_1`, () => HttpResponse.json(FULL_CAMPAIGN)),
    );

    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'create_campaign', {
      connectionKey: CONNECTION_KEY,
      accountId: 'act_123',
      name: 'Summer Sale',
      objective: 'OUTCOME_TRAFFIC',
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    const campaign = JSON.parse(body.result!.content[0].text);
    expect(campaign.status).toBe('PAUSED');
  });

  it('rejects an invalid objective before any HTTP call is made', async () => {
    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'create_campaign', {
      connectionKey: CONNECTION_KEY,
      accountId: 'act_123',
      name: 'Bad',
      objective: 'NOT_A_REAL_OBJECTIVE',
    });
    // MSW would throw on an unhandled request if this leaked through to a real call.
    expect(res.status).toBe(200);
    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBe(true);
  });
});
