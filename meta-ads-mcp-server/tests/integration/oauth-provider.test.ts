import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/server.js';

function makePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function registerClient(): Promise<{ clientId: string }> {
  const res = await request(app)
    .post('/register')
    .send({
      redirect_uris: ['https://claude.example/callback'],
      client_name: 'Test Client',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  expect(res.status).toBe(201);
  return { clientId: res.body.client_id };
}

async function authorizeToConsent(
  clientId: string,
  challenge: string,
  state = 'test-state',
): Promise<{ consentId: string }> {
  const res = await request(app).get('/authorize').query({
    client_id: clientId,
    redirect_uri: 'https://claude.example/callback',
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  expect(res.status).toBe(302);
  const location = new URL(res.headers.location, 'http://localhost');
  expect(location.pathname).toBe('/oauth/consent');
  return { consentId: location.searchParams.get('consentId')! };
}

describe('OAuth 2.1 authorization server for /mcp', () => {
  it('advertises protected resource and authorization server metadata', async () => {
    const prm = await request(app).get('/.well-known/oauth-protected-resource/mcp');
    expect(prm.status).toBe(200);
    expect(prm.body.resource).toMatch(/\/mcp$/);
    expect(prm.body.authorization_servers).toBeInstanceOf(Array);

    const asMeta = await request(app).get('/.well-known/oauth-authorization-server');
    expect(asMeta.status).toBe(200);
    expect(asMeta.body.authorization_endpoint).toMatch(/\/authorize$/);
    expect(asMeta.body.token_endpoint).toMatch(/\/token$/);
    expect(asMeta.body.registration_endpoint).toMatch(/\/register$/);
    expect(asMeta.body.code_challenge_methods_supported).toContain('S256');
  });

  it('includes resource_metadata in the WWW-Authenticate header on an unauthenticated /mcp request', async () => {
    const res = await request(app).post('/mcp').send({});
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata=');
  });

  it('dynamically registers a new client', async () => {
    const { clientId } = await registerClient();
    expect(clientId).toBeTruthy();
  });

  it('redirects /authorize to the consent screen for a registered client', async () => {
    const { clientId } = await registerClient();
    const { challenge } = makePkcePair();
    const { consentId } = await authorizeToConsent(clientId, challenge);
    expect(consentId).toBeTruthy();
  });

  it('rejects /authorize for an unregistered client_id', async () => {
    const { challenge } = makePkcePair();
    const res = await request(app).get('/authorize').query({
      client_id: 'does-not-exist',
      redirect_uri: 'https://claude.example/callback',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    expect(res.status).toBe(400);
  });

  it('renders the consent form with the client name', async () => {
    const { clientId } = await registerClient();
    const { challenge } = makePkcePair();
    const { consentId } = await authorizeToConsent(clientId, challenge);

    const res = await request(app).get('/oauth/consent').query({ consentId });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Test Client');
    expect(res.text).toContain(consentId);
  });

  it('rejects the wrong operator password and re-renders the form', async () => {
    const { clientId } = await registerClient();
    const { challenge } = makePkcePair();
    const { consentId } = await authorizeToConsent(clientId, challenge);

    const res = await request(app).post('/oauth/consent').type('form').send({ consentId, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.text).toContain('Incorrect password');
  });

  it('rejects an unknown consentId', async () => {
    const res = await request(app)
      .post('/oauth/consent')
      .type('form')
      .send({ consentId: 'does-not-exist', password: 'test-oauth-admin-password-not-for-production' });
    expect(res.status).toBe(400);
  });

  it('accepts the consent form submission when the browser sends Origin: null (sandboxed iframe/popup, e.g. claude.ai)', async () => {
    const { clientId } = await registerClient();
    const { challenge } = makePkcePair();
    const { consentId } = await authorizeToConsent(clientId, challenge);

    const res = await request(app)
      .post('/oauth/consent')
      .set('Origin', 'null')
      .type('form')
      .send({ consentId, password: 'test-oauth-admin-password-not-for-production' });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).searchParams.get('code')).toBeTruthy();
  });

  it('still rejects a real cross-origin request', async () => {
    const { clientId } = await registerClient();
    const { challenge } = makePkcePair();
    const { consentId } = await authorizeToConsent(clientId, challenge);

    const res = await request(app)
      .post('/oauth/consent')
      .set('Origin', 'https://evil.example')
      .type('form')
      .send({ consentId, password: 'test-oauth-admin-password-not-for-production' });
    expect(res.status).toBe(500);
  });

  it('completes the full authorize -> consent -> token -> /mcp flow', async () => {
    const { clientId } = await registerClient();
    const { verifier, challenge } = makePkcePair();
    const { consentId } = await authorizeToConsent(clientId, challenge, 'round-trip-state');

    const consentRes = await request(app)
      .post('/oauth/consent')
      .type('form')
      .send({ consentId, password: 'test-oauth-admin-password-not-for-production' });
    expect(consentRes.status).toBe(302);
    const redirectUrl = new URL(consentRes.headers.location);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe('https://claude.example/callback');
    expect(redirectUrl.searchParams.get('state')).toBe('round-trip-state');
    const code = redirectUrl.searchParams.get('code')!;
    expect(code).toBeTruthy();

    const tokenRes = await request(app).post('/token').type('form').send({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: 'https://claude.example/callback',
      client_id: clientId,
    });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.token_type).toBe('Bearer');
    expect(tokenRes.body.access_token).toBeTruthy();
    expect(tokenRes.body.refresh_token).toBeUndefined();

    const mcpRes = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${tokenRes.body.access_token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      });
    expect(mcpRes.status).toBe(200);
  });

  it('rejects a replayed authorization code', async () => {
    const { clientId } = await registerClient();
    const { verifier, challenge } = makePkcePair();
    const { consentId } = await authorizeToConsent(clientId, challenge);

    const consentRes = await request(app)
      .post('/oauth/consent')
      .type('form')
      .send({ consentId, password: 'test-oauth-admin-password-not-for-production' });
    const code = new URL(consentRes.headers.location).searchParams.get('code')!;

    const exchangeOnce = async () =>
      request(app).post('/token').type('form').send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: 'https://claude.example/callback',
        client_id: clientId,
      });

    const first = await exchangeOnce();
    expect(first.status).toBe(200);

    const second = await exchangeOnce();
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_grant');
  });

  it('rejects a mismatched PKCE code_verifier', async () => {
    const { clientId } = await registerClient();
    const { challenge } = makePkcePair();
    const wrongVerifier = randomBytes(32).toString('base64url');
    const { consentId } = await authorizeToConsent(clientId, challenge);

    const consentRes = await request(app)
      .post('/oauth/consent')
      .type('form')
      .send({ consentId, password: 'test-oauth-admin-password-not-for-production' });
    const code = new URL(consentRes.headers.location).searchParams.get('code')!;

    const tokenRes = await request(app).post('/token').type('form').send({
      grant_type: 'authorization_code',
      code,
      code_verifier: wrongVerifier,
      redirect_uri: 'https://claude.example/callback',
      client_id: clientId,
    });
    expect(tokenRes.status).toBe(400);
    expect(tokenRes.body.error).toBe('invalid_grant');
  });

  it('rejects refresh_token grants, since this server does not issue refresh tokens', async () => {
    const { clientId } = await registerClient();
    const res = await request(app).post('/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: 'anything',
      client_id: clientId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });
});
