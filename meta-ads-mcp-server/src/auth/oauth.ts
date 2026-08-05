import axios from 'axios';
import { META_GRAPH_BASE_URL, META_OAUTH_DIALOG_URL } from '../config/constants.js';
import { env, metaOAuthScopes } from '../config/env.js';
import { parseMetaApiError } from '../utils/metaErrors.js';
import { logger } from '../utils/logger.js';
import { exchangeForLongLivedToken, storeToken, type MetaTokenRecord } from './tokenManager.js';

interface MetaCodeExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface MetaMeResponse {
  id: string;
  name: string;
}

interface MetaBusinessListResponse {
  data: Array<{ id: string; name: string }>;
}

/** Builds the Meta OAuth dialog URL the user is redirected to for /auth/meta/login. */
export function buildAuthorizationUrl(state: string): string {
  const url = new URL(META_OAUTH_DIALOG_URL);
  url.searchParams.set('client_id', env.META_APP_ID);
  url.searchParams.set('redirect_uri', env.META_OAUTH_REDIRECT_URI);
  url.searchParams.set('scope', metaOAuthScopes.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeCodeForShortLivedToken(code: string): Promise<string> {
  try {
    const response = await axios.get<MetaCodeExchangeResponse>(`${META_GRAPH_BASE_URL}/oauth/access_token`, {
      params: {
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        redirect_uri: env.META_OAUTH_REDIRECT_URI,
        code,
      },
    });
    return response.data.access_token;
  } catch (error) {
    throw parseMetaApiError(error);
  }
}

async function fetchMe(accessToken: string): Promise<MetaMeResponse> {
  try {
    const response = await axios.get<MetaMeResponse>(`${META_GRAPH_BASE_URL}/me`, {
      params: { fields: 'id,name', access_token: accessToken },
    });
    return response.data;
  } catch (error) {
    throw parseMetaApiError(error);
  }
}

async function fetchBusinesses(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const response = await axios.get<MetaBusinessListResponse>(`${META_GRAPH_BASE_URL}/me/businesses`, {
      params: { fields: 'id,name', access_token: accessToken },
    });
    return response.data.data;
  } catch (error) {
    throw parseMetaApiError(error);
  }
}

/**
 * Completes the OAuth code exchange, upgrades to a long-lived token, and persists
 * one token record per connected Business Manager (or a single 'personal' record
 * if the user has no Business Manager). Returns every record that was stored.
 */
export async function handleOAuthCallback(code: string): Promise<MetaTokenRecord[]> {
  const shortLivedToken = await exchangeCodeForShortLivedToken(code);
  const longLived = await exchangeForLongLivedToken(shortLivedToken);
  const me = await fetchMe(longLived.accessToken);
  const businesses = await fetchBusinesses(longLived.accessToken);

  const obtainedAt = Date.now();
  const baseRecord = {
    accessToken: longLived.accessToken,
    obtainedAt,
    expiresAt: longLived.expiresAt,
    scopes: metaOAuthScopes,
    metaUserId: me.id,
  };

  const records: MetaTokenRecord[] =
    businesses.length > 0
      ? businesses.map((business) => ({
          ...baseRecord,
          key: business.id,
          businessId: business.id,
          businessName: business.name,
        }))
      : [{ ...baseRecord, key: 'personal' }];

  for (const record of records) {
    await storeToken(record);
  }

  logger.info(
    { metaUserId: me.id, connections: records.map((r) => r.key) },
    'meta_oauth_connected',
  );

  return records;
}
