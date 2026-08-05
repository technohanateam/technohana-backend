import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { mswServer } from '../setup.js';
import { storeToken } from '../../src/auth/tokenManager.js';
import { initMcpSession, callTool, parseMcpResponse } from './mcpTestHelpers.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const CONNECTION_KEY = 'insights-test-connection';

const RAW_INSIGHT_ROW = {
  date_start: '2026-01-01',
  date_stop: '2026-01-07',
  account_id: '123',
  campaign_id: 'camp_1',
  spend: '150.50',
  impressions: '10000',
  reach: '9000',
  clicks: '300',
  ctr: '3.0',
  cpc: '0.50',
  cpm: '15.05',
  frequency: '1.11',
  actions: [
    { action_type: 'purchase', value: '12' },
    { action_type: 'link_click', value: '250' },
  ],
  cost_per_action_type: [{ action_type: 'purchase', value: '12.54' }],
  purchase_roas: [{ action_type: 'omni_purchase', value: '4.5' }],
};

interface CallToolResultBody {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

describe('campaign_insights / retrieve_* metric tools (real HTTP + MCP stack, Meta API mocked)', () => {
  beforeEach(async () => {
    await storeToken({
      key: CONNECTION_KEY,
      accessToken: 'insights-token',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: ['ads_read'],
    });
  });

  it('maps actions/cost_per_action_type/purchase_roas into purchases/cpa/roas correctly', async () => {
    mswServer.use(
      http.get(`${GRAPH_BASE}/act_123/insights`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get('level')).toBe('campaign');
        expect(JSON.parse(params.get('filtering')!)).toEqual([{ field: 'campaign.id', operator: 'IN', value: ['camp_1'] }]);
        return HttpResponse.json({ data: [RAW_INSIGHT_ROW] });
      }),
    );

    const session = await initMcpSession('analyst');
    const res = await callTool(session, 'campaign_insights', {
      connectionKey: CONNECTION_KEY,
      accountId: 'act_123',
      level: 'campaign',
      campaignIds: ['camp_1'],
      datePreset: 'last_7d',
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    const rows = JSON.parse(body.result!.content[0].text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      spend: 150.5,
      ctr: 3,
      cpc: 0.5,
      cpm: 15.05,
      purchases: 12,
      cpa: 12.54,
      roas: 4.5,
      accountId: 'act_123',
      campaignId: 'camp_1',
    });
  });

  it('retrieve_roas projects down to just the identifying fields plus roas', async () => {
    mswServer.use(http.get(`${GRAPH_BASE}/act_123/insights`, () => HttpResponse.json({ data: [RAW_INSIGHT_ROW] })));

    const session = await initMcpSession('analyst');
    const res = await callTool(session, 'retrieve_roas', {
      connectionKey: CONNECTION_KEY,
      accountId: 'act_123',
      level: 'campaign',
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    const rows = JSON.parse(body.result!.content[0].text);
    expect(rows).toEqual([
      { dateStart: '2026-01-01', dateStop: '2026-01-07', campaignId: 'camp_1', adSetId: undefined, adId: undefined, roas: 4.5 },
    ]);
  });

  it('viewer role is denied access to campaign_insights (analyst-tier tool)', async () => {
    const session = await initMcpSession('viewer');
    const res = await callTool(session, 'campaign_insights', {
      connectionKey: CONNECTION_KEY,
      accountId: 'act_123',
      level: 'campaign',
    });
    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0].text).toMatch(/not permitted/);
  });
});
