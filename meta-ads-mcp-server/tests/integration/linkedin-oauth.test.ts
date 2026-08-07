import request from 'supertest';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../../src/server.js';
import { LINKEDIN_API_BASE_URL, LINKEDIN_OAUTH_TOKEN_URL } from '../../src/config/constants.js';
import { deleteToken } from '../../src/auth/linkedinTokenManager.js';
import { mswServer } from '../setup.js';

const createdKeys = new Set<string>();

afterEach(async () => {
  for (const key of createdKeys) {
    await deleteToken(key);
  }
  createdKeys.clear();
});

describe('LinkedIn OAuth', () => {
  it('redirects /auth/linkedin/login to the LinkedIn OAuth dialog with a signed state param', async () => {
    const res = await request(app).get('/auth/linkedin/login');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(location.searchParams.get('client_id')).toBe('test-linkedin-client-id');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('state')).toMatch(/^\d+\.[0-9a-f]+$/);
  });

  it('rejects the callback with no code or state', async () => {
    const res = await request(app).get('/auth/linkedin/callback');
    expect(res.status).toBe(400);
  });

  it('rejects the callback with a well-formed but tampered state signature', async () => {
    const loginRes = await request(app).get('/auth/linkedin/login');
    const realState = new URL(loginRes.headers.location).searchParams.get('state')!;
    const [timestamp] = realState.split('.');
    const tamperedState = `${timestamp}.${'f'.repeat(64)}`;
    const res = await request(app).get('/auth/linkedin/callback').query({ code: 'abc', state: tamperedState });
    expect(res.status).toBe(400);
  });

  it('rejects a Meta-flow state replayed against the LinkedIn callback', async () => {
    const metaLoginRes = await request(app).get('/auth/meta/login');
    const metaState = new URL(metaLoginRes.headers.location).searchParams.get('state')!;
    const res = await request(app).get('/auth/linkedin/callback').query({ code: 'abc', state: metaState });
    expect(res.status).toBe(400);
  });

  it('surfaces a friendly message when the user denies the LinkedIn authorization prompt', async () => {
    const res = await request(app)
      .get('/auth/linkedin/callback')
      .query({ error: 'user_cancelled_login', error_description: 'User denied the request' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('User denied the request');
  });

  it('completes the full OAuth flow, storing one connection per administered organization', async () => {
    const loginRes = await request(app).get('/auth/linkedin/login');
    const validState = new URL(loginRes.headers.location).searchParams.get('state')!;

    mswServer.use(
      http.post(LINKEDIN_OAUTH_TOKEN_URL, async ({ request: req }) => {
        const body = new URLSearchParams(await req.text());
        expect(body.get('code')).toBe('test-auth-code');
        return HttpResponse.json({ access_token: 'member-access-token', expires_in: 5184000, refresh_token: 'member-refresh-token' });
      }),
      http.get(`${LINKEDIN_API_BASE_URL}/organizationAcls`, ({ request: req }) => {
        expect(new URL(req.url).searchParams.get('role')).toBe('ADMINISTRATOR');
        return HttpResponse.json({
          elements: [{ organization: 'urn:li:organization:9001', role: 'ADMINISTRATOR', state: 'APPROVED' }],
        });
      }),
      http.get(`${LINKEDIN_API_BASE_URL}/organizations/9001`, () =>
        HttpResponse.json({ id: 9001, localizedName: 'Acme Corp' }),
      ),
    );

    const res = await request(app).get('/auth/linkedin/callback').query({ code: 'test-auth-code', state: validState });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.connections).toEqual([{ key: 'urn:li:organization:9001', organizationName: 'Acme Corp' }]);
    createdKeys.add('urn:li:organization:9001');
  });

  it('stores a single "personal" connection when the member administers no organizations', async () => {
    const loginRes = await request(app).get('/auth/linkedin/login');
    const validState = new URL(loginRes.headers.location).searchParams.get('state')!;

    mswServer.use(
      http.post(LINKEDIN_OAUTH_TOKEN_URL, () =>
        HttpResponse.json({ access_token: 'solo-access-token', expires_in: 5184000 }),
      ),
      http.get(`${LINKEDIN_API_BASE_URL}/organizationAcls`, () => HttpResponse.json({ elements: [] })),
    );

    const res = await request(app).get('/auth/linkedin/callback').query({ code: 'test-auth-code-2', state: validState });
    expect(res.status).toBe(200);
    expect(res.body.connections).toEqual([{ key: 'personal', organizationName: null }]);
    createdKeys.add('personal');
  });
});
