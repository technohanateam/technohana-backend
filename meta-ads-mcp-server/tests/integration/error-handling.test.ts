import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { mswServer } from '../setup.js';
import { storeToken } from '../../src/auth/tokenManager.js';
import { initMcpSession, callTool, parseMcpResponse } from './mcpTestHelpers.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const CONNECTION_KEY = 'error-handling-test-connection';

interface CallToolResultBody {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function metaError(code: number, message: string) {
  return HttpResponse.json({ error: { message, type: 'OAuthException', code, fbtrace_id: 'trace-abc' } }, { status: 400 });
}

describe('Meta API error handling and retry', () => {
  beforeEach(async () => {
    await storeToken({
      key: CONNECTION_KEY,
      accessToken: 'error-handling-token',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: ['ads_read'],
    });
  });

  // Each test below uses its own accountId - listCampaigns caches successful
  // results per accountId (see campaigns.service.ts), so reusing one across
  // tests would let a later test silently observe an earlier test's cached
  // response instead of actually exercising the Meta API call it mocks.

  it('surfaces an expired-token Meta error as a clean tool error without leaking a stack trace', async () => {
    mswServer.use(http.get(`${GRAPH_BASE}/act_190/campaigns`, () => metaError(190, 'Error validating access token')));

    const session = await initMcpSession('analyst');
    const res = await callTool(session, 'list_campaigns', { connectionKey: CONNECTION_KEY, accountId: 'act_190' });

    expect(res.status).toBe(200); // Tool errors are reported inside the MCP result, not as an HTTP error status.
    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0].text).toContain('Error validating access token');
    expect(body.result?.content[0].text).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no stack trace lines leaked
  });

  it('surfaces a permission error with a clear message', async () => {
    mswServer.use(http.get(`${GRAPH_BASE}/act_200/campaigns`, () => metaError(200, 'Permission denied for this ad account')));

    const session = await initMcpSession('analyst');
    const res = await callTool(session, 'list_campaigns', { connectionKey: CONNECTION_KEY, accountId: 'act_200' });
    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0].text).toContain('Permission denied for this ad account');
  });

  it('retries a transient/rate-limit Meta error and succeeds once the retry goes through', async () => {
    let attempts = 0;
    mswServer.use(
      http.get(`${GRAPH_BASE}/act_401/campaigns`, () => {
        attempts += 1;
        if (attempts === 1) {
          return metaError(4, 'Application request limit reached');
        }
        return HttpResponse.json({ data: [] });
      }),
    );

    const session = await initMcpSession('analyst');
    const res = await callTool(session, 'list_campaigns', { connectionKey: CONNECTION_KEY, accountId: 'act_401' });
    const body = parseMcpResponse<CallToolResultBody>(res);

    expect(body.result?.isError).toBeFalsy();
    expect(attempts).toBe(2);
    expect(JSON.parse(body.result!.content[0].text)).toEqual([]);
  });

  it('gives up after exhausting retries on a persistently failing transient error', async () => {
    let attempts = 0;
    mswServer.use(
      http.get(`${GRAPH_BASE}/act_402/campaigns`, () => {
        attempts += 1;
        return metaError(4, 'Application request limit reached');
      }),
    );

    const session = await initMcpSession('analyst');
    const res = await callTool(session, 'list_campaigns', { connectionKey: CONNECTION_KEY, accountId: 'act_402' });
    const body = parseMcpResponse<CallToolResultBody>(res);

    expect(body.result?.isError).toBe(true);
    expect(attempts).toBe(4); // RETRY_DEFAULTS.maxAttempts
  }, 20000);
});
