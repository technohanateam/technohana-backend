import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mswServer } from '../setup.js';
import { deleteToken, storeToken } from '../../src/auth/linkedinTokenManager.js';
import { LINKEDIN_API_BASE_URL } from '../../src/config/constants.js';
import { initMcpSession, callTool, parseMcpResponse } from './mcpTestHelpers.js';

const CONNECTION_KEY = 'urn:li:organization:linkedin-insights-leadgen-test';
const ACCOUNT_URN = 'urn:li:sponsoredAccount:222';
const FORM_URN = 'urn:li:leadGenForm:123';

interface CallToolResultBody {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

describe('LinkedIn insights & lead gen tools (real HTTP + MCP stack, LinkedIn API mocked)', () => {
  beforeEach(async () => {
    await storeToken({
      key: CONNECTION_KEY,
      accessToken: 'seeded-linkedin-access-token',
      refreshToken: 'seeded-refresh-token',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: ['r_ads_reporting'],
      organizationUrn: CONNECTION_KEY,
    });
  });

  afterEach(async () => {
    await deleteToken(CONNECTION_KEY);
  });

  it('retrieves full campaign insights with computed CTR/CPC/CPM', async () => {
    mswServer.use(
      http.get(`${LINKEDIN_API_BASE_URL}/adAccounts/222`, () =>
        HttpResponse.json({ id: 222, name: 'Test Account', status: 'ACTIVE', type: 'BUSINESS', currency: 'EUR' }),
      ),
      http.get(`${LINKEDIN_API_BASE_URL}/adAnalytics`, ({ request: req }) => {
        const params = new URL(req.url).searchParams;
        expect(params.get('pivot')).toBe('CAMPAIGN');
        expect(params.get('accounts')).toBe(`List(${ACCOUNT_URN})`);
        return HttpResponse.json({
          elements: [
            {
              dateRange: { start: { day: 1, month: 6, year: 2026 }, end: { day: 30, month: 6, year: 2026 } },
              pivotValues: ['urn:li:sponsoredCampaign:555'],
              impressions: 10000,
              clicks: 250,
              costInLocalCurrency: '500.00',
              oneClickLeads: 20,
            },
          ],
        });
      }),
    );

    const session = await initMcpSession('analyst');
    const res = await callTool(session, 'linkedin_campaign_insights', {
      connectionKey: CONNECTION_KEY,
      accountUrn: ACCOUNT_URN,
      since: '2026-06-01',
      until: '2026-06-30',
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    const rows = JSON.parse(body.result!.content[0].text);
    expect(rows[0]).toMatchObject({
      campaignUrn: 'urn:li:sponsoredCampaign:555',
      impressions: 10000,
      clicks: 250,
      costInLocalCurrency: 500,
      ctr: 0.025,
      cpc: 2,
      cpm: 50,
      cpl: 25,
      currency: 'EUR',
    });
  });

  it('denies a viewer-role attempt to read insights (RBAC enforced)', async () => {
    const session = await initMcpSession('viewer');
    const res = await callTool(session, 'linkedin_campaign_insights', {
      connectionKey: CONNECTION_KEY,
      accountUrn: ACCOUNT_URN,
      since: '2026-06-01',
      until: '2026-06-30',
    });
    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0].text).toMatch(/not permitted/);
  });

  it('lists lead gen forms', async () => {
    mswServer.use(
      http.get(`${LINKEDIN_API_BASE_URL}/leadForms`, () =>
        HttpResponse.json({ elements: [{ id: FORM_URN, name: 'Free Trial Signup', status: 'ACTIVE', leadsCount: 42 }] }),
      ),
    );

    const session = await initMcpSession('analyst');
    const res = await callTool(session, 'linkedin_list_lead_gen_forms', {
      connectionKey: CONNECTION_KEY,
      accountUrn: ACCOUNT_URN,
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    const forms = JSON.parse(body.result!.content[0].text);
    expect(forms).toEqual([{ urn: FORM_URN, id: '123', accountUrn: ACCOUNT_URN, name: 'Free Trial Signup', status: 'ACTIVE', leadsCount: 42 }]);
  });

  it('downloads leads across pages and computes lead statistics', async () => {
    const recentLead = {
      id: 'lead_1',
      leadType: 'SPONSORED',
      form: FORM_URN,
      submittedAt: Date.now() - 24 * 60 * 60 * 1000,
      formResponse: { answers: [{ name: 'email', value: 'test@example.com' }] },
    };
    const oldLead = {
      id: 'lead_2',
      leadType: 'SPONSORED',
      form: FORM_URN,
      submittedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      formResponse: { answers: [{ name: 'email', value: 'old@example.com' }] },
    };

    mswServer.use(
      http.get(`${LINKEDIN_API_BASE_URL}/leadFormResponses`, ({ request: req }) => {
        const start = Number(new URL(req.url).searchParams.get('start') ?? 0);
        if (start === 0) {
          return HttpResponse.json({ elements: [recentLead, oldLead], paging: { start: 0, count: 100, total: 2 } });
        }
        return HttpResponse.json({ elements: [], paging: { start, count: 100, total: 2 } });
      }),
    );

    const session = await initMcpSession('analyst');
    const statsRes = await callTool(session, 'linkedin_lead_statistics', { connectionKey: CONNECTION_KEY, formUrn: FORM_URN });
    const statsBody = parseMcpResponse<CallToolResultBody>(statsRes);
    const stats = JSON.parse(statsBody.result!.content[0].text);
    expect(stats).toMatchObject({ formUrn: FORM_URN, totalLeads: 2, leadsLast7Days: 1, leadsLast30Days: 1 });
  });
});
