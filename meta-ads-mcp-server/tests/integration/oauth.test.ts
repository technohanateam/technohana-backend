import request from 'supertest';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/server.js';
import { mswServer } from '../setup.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

describe('Meta OAuth', () => {
  it('redirects /auth/meta/login to the Meta OAuth dialog with a signed state param', async () => {
    const res = await request(app).get('/auth/meta/login');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(location.searchParams.get('client_id')).toBe('test-app-id');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('state')).toMatch(/^\d+\.[0-9a-f]+$/);
  });

  it('rejects the callback with no code or state', async () => {
    const res = await request(app).get('/auth/meta/callback');
    expect(res.status).toBe(400);
  });

  it('rejects the callback with a valid code but garbage state', async () => {
    const res = await request(app).get('/auth/meta/callback').query({ code: 'abc', state: 'not-a-real-state' });
    expect(res.status).toBe(400);
  });

  it('rejects the callback with a well-formed but tampered state signature', async () => {
    const loginRes = await request(app).get('/auth/meta/login');
    const realState = new URL(loginRes.headers.location).searchParams.get('state')!;
    const [timestamp] = realState.split('.');
    const tamperedState = `${timestamp}.${'f'.repeat(64)}`;
    const res = await request(app).get('/auth/meta/callback').query({ code: 'abc', state: tamperedState });
    expect(res.status).toBe(400);
  });

  it('surfaces a friendly message when the user denies the Meta authorization prompt', async () => {
    const res = await request(app)
      .get('/auth/meta/callback')
      .query({ error: 'access_denied', error_description: 'User denied the request' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('User denied the request');
  });

  it('completes the full OAuth flow end-to-end with a valid code and state', async () => {
    const loginRes = await request(app).get('/auth/meta/login');
    const validState = new URL(loginRes.headers.location).searchParams.get('state')!;

    mswServer.use(
      http.get(`${GRAPH_BASE}/oauth/access_token`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get('grant_type') === 'fb_exchange_token') {
          expect(params.get('fb_exchange_token')).toBe('short_lived_token');
          return HttpResponse.json({ access_token: 'long_lived_token', token_type: 'bearer', expires_in: 5184000 });
        }
        expect(params.get('code')).toBe('test-auth-code');
        return HttpResponse.json({ access_token: 'short_lived_token', token_type: 'bearer', expires_in: 3600 });
      }),
      http.get(`${GRAPH_BASE}/me`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('access_token')).toBe('long_lived_token');
        return HttpResponse.json({ id: 'meta_user_1', name: 'Test User' });
      }),
      http.get(`${GRAPH_BASE}/me/businesses`, () => HttpResponse.json({ data: [{ id: 'biz_1', name: 'Acme Business' }] })),
    );

    const res = await request(app).get('/auth/meta/callback').query({ code: 'test-auth-code', state: validState });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.connections).toEqual([{ key: 'biz_1', businessName: 'Acme Business' }]);
  });

  it('stores a single "personal" connection when the user has no Business Manager', async () => {
    const loginRes = await request(app).get('/auth/meta/login');
    const validState = new URL(loginRes.headers.location).searchParams.get('state')!;

    mswServer.use(
      http.get(`${GRAPH_BASE}/oauth/access_token`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        return params.get('grant_type') === 'fb_exchange_token'
          ? HttpResponse.json({ access_token: 'long_lived_token_2', token_type: 'bearer', expires_in: 5184000 })
          : HttpResponse.json({ access_token: 'short_lived_token_2', token_type: 'bearer', expires_in: 3600 });
      }),
      http.get(`${GRAPH_BASE}/me`, () => HttpResponse.json({ id: 'meta_user_2', name: 'Solo User' })),
      http.get(`${GRAPH_BASE}/me/businesses`, () => HttpResponse.json({ data: [] })),
    );

    const res = await request(app).get('/auth/meta/callback').query({ code: 'test-auth-code-2', state: validState });
    expect(res.status).toBe(200);
    expect(res.body.connections).toEqual([{ key: 'personal', businessName: null }]);
  });
});
