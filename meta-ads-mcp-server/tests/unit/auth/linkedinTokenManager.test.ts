import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LINKEDIN_OAUTH_TOKEN_URL } from '../../../src/config/constants.js';
import {
  deleteToken,
  exchangeCodeForTokens,
  getDefaultConnectionKey,
  getFreshAccessToken,
  getToken,
  refreshAccessToken,
  storeToken,
  type LinkedInTokenRecord,
} from '../../../src/auth/linkedinTokenManager.js';
import { mswServer } from '../../setup.js';

const TEST_KEYS = ['urn:li:organization:token-mgr-test-1', 'urn:li:organization:token-mgr-test-2'];

async function cleanup(): Promise<void> {
  for (const key of TEST_KEYS) {
    await deleteToken(key);
  }
}

describe('linkedinTokenManager', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('exchangeCodeForTokens posts the authorization_code grant and parses the response', async () => {
    mswServer.use(
      http.post(LINKEDIN_OAUTH_TOKEN_URL, async ({ request }) => {
        const body = new URLSearchParams(await request.text());
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('test-code');
        expect(body.get('client_id')).toBe('test-linkedin-client-id');
        return HttpResponse.json({
          access_token: 'access-1',
          expires_in: 5184000,
          refresh_token: 'refresh-1',
          refresh_token_expires_in: 31536000,
        });
      }),
    );

    const result = await exchangeCodeForTokens('test-code');
    expect(result.accessToken).toBe('access-1');
    expect(result.refreshToken).toBe('refresh-1');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.refreshTokenExpiresAt).toBeGreaterThan(Date.now());
  });

  it('refreshAccessToken posts the refresh_token grant and parses the response', async () => {
    mswServer.use(
      http.post(LINKEDIN_OAUTH_TOKEN_URL, async ({ request }) => {
        const body = new URLSearchParams(await request.text());
        expect(body.get('grant_type')).toBe('refresh_token');
        expect(body.get('refresh_token')).toBe('old-refresh');
        return HttpResponse.json({ access_token: 'new-access', expires_in: 5184000 });
      }),
    );

    const result = await refreshAccessToken('old-refresh');
    expect(result.accessToken).toBe('new-access');
    expect(result.refreshToken).toBeUndefined();
  });

  it('round-trips a token record through store/get/delete', async () => {
    const record: LinkedInTokenRecord = {
      key: TEST_KEYS[0]!,
      accessToken: 'access',
      refreshToken: 'refresh',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: ['r_ads'],
      organizationUrn: TEST_KEYS[0],
      organizationName: 'Acme Corp',
    };
    await storeToken(record);
    await expect(getToken(TEST_KEYS[0]!)).resolves.toEqual(record);

    await deleteToken(TEST_KEYS[0]!);
    await expect(getToken(TEST_KEYS[0]!)).resolves.toBeNull();
  });

  it('getFreshAccessToken returns the stored token unchanged when far from expiry', async () => {
    const record: LinkedInTokenRecord = {
      key: TEST_KEYS[0]!,
      accessToken: 'still-fresh',
      refreshToken: 'refresh',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: ['r_ads'],
    };
    await storeToken(record);
    await expect(getFreshAccessToken(TEST_KEYS[0]!)).resolves.toBe('still-fresh');
  });

  it('getFreshAccessToken refreshes and persists a new token when close to expiry', async () => {
    mswServer.use(
      http.post(LINKEDIN_OAUTH_TOKEN_URL, () =>
        HttpResponse.json({ access_token: 'refreshed-access', expires_in: 5184000, refresh_token: 'rotated-refresh' }),
      ),
    );

    const record: LinkedInTokenRecord = {
      key: TEST_KEYS[0]!,
      accessToken: 'about-to-expire',
      refreshToken: 'refresh-to-use',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 1000,
      scopes: ['r_ads'],
    };
    await storeToken(record);

    const token = await getFreshAccessToken(TEST_KEYS[0]!);
    expect(token).toBe('refreshed-access');

    const updated = await getToken(TEST_KEYS[0]!);
    expect(updated?.accessToken).toBe('refreshed-access');
    expect(updated?.refreshToken).toBe('rotated-refresh');
  });

  it('getFreshAccessToken throws when no connection exists for the key', async () => {
    await expect(getFreshAccessToken('urn:li:organization:does-not-exist')).rejects.toThrow(/No LinkedIn connection found/);
  });

  it('getFreshAccessToken throws when the token has expired and no refresh token is stored', async () => {
    const record: LinkedInTokenRecord = {
      key: TEST_KEYS[0]!,
      accessToken: 'expired',
      obtainedAt: Date.now() - 1000,
      expiresAt: Date.now() - 1000,
      scopes: ['r_ads'],
    };
    await storeToken(record);
    await expect(getFreshAccessToken(TEST_KEYS[0]!)).rejects.toThrow(/expired/);
  });

  it('getDefaultConnectionKey resolves the single stored connection', async () => {
    await storeToken({
      key: TEST_KEYS[0]!,
      accessToken: 'a',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: [],
    });
    await expect(getDefaultConnectionKey()).resolves.toBe(TEST_KEYS[0]);
  });

  it('getDefaultConnectionKey throws when multiple connections are stored', async () => {
    await storeToken({
      key: TEST_KEYS[0]!,
      accessToken: 'a',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: [],
    });
    await storeToken({
      key: TEST_KEYS[1]!,
      accessToken: 'b',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: [],
    });
    await expect(getDefaultConnectionKey()).rejects.toThrow(/Multiple LinkedIn connections/);
  });
});
