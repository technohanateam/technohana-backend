import axios from 'axios';
import { META_GRAPH_BASE_URL } from '../config/constants.js';
import { env } from '../config/env.js';
import { getStorageAdapter } from '../storage/storage.factory.js';
import { STORAGE_NAMESPACES } from '../config/constants.js';
import { parseMetaApiError } from '../utils/metaErrors.js';
import { logger } from '../utils/logger.js';

/** Long-lived Meta tokens are refreshed once fewer than this many ms remain. */
const REFRESH_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

export interface MetaTokenRecord {
  /** Storage key: the connected Business Manager ID, or 'personal' for a user without one. */
  key: string;
  accessToken: string;
  obtainedAt: number;
  /** Epoch ms. Meta long-lived tokens are typically valid ~60 days from exchange. */
  expiresAt: number;
  scopes: string[];
  metaUserId?: string;
  businessId?: string;
  businessName?: string;
}

interface MetaTokenExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

function nowMs(): number {
  return Date.now();
}

/**
 * Exchanges a short-lived user access token (obtained from the OAuth code
 * exchange) for a long-lived one (~60 day validity). Also used to refresh an
 * existing long-lived token by re-exchanging it before it expires.
 */
export async function exchangeForLongLivedToken(shortLivedOrExistingToken: string): Promise<{
  accessToken: string;
  expiresAt: number;
}> {
  try {
    const response = await axios.get<MetaTokenExchangeResponse>(`${META_GRAPH_BASE_URL}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        fb_exchange_token: shortLivedOrExistingToken,
      },
    });
    const expiresInMs = (response.data.expires_in ?? 60 * 24 * 60 * 60) * 1000;
    return { accessToken: response.data.access_token, expiresAt: nowMs() + expiresInMs };
  } catch (error) {
    throw parseMetaApiError(error);
  }
}

export async function storeToken(record: MetaTokenRecord): Promise<void> {
  await getStorageAdapter().set(STORAGE_NAMESPACES.META_TOKENS, record.key, record);
}

export async function getToken(key: string): Promise<MetaTokenRecord | null> {
  return getStorageAdapter().get<MetaTokenRecord>(STORAGE_NAMESPACES.META_TOKENS, key);
}

export async function deleteToken(key: string): Promise<void> {
  await getStorageAdapter().delete(STORAGE_NAMESPACES.META_TOKENS, key);
}

export async function listConnections(): Promise<MetaTokenRecord[]> {
  const keys = await getStorageAdapter().listKeys(STORAGE_NAMESPACES.META_TOKENS);
  const records = await Promise.all(keys.map((key) => getToken(key)));
  return records.filter((record): record is MetaTokenRecord => record !== null);
}

/**
 * Returns a valid access token for `key`, transparently refreshing it first if
 * it is within REFRESH_THRESHOLD_MS of expiry. Throws if no connection exists
 * for `key` or the stored token has already expired and could not be refreshed.
 */
export async function getFreshAccessToken(key: string): Promise<string> {
  const record = await getToken(key);
  if (!record) {
    throw new Error(
      `No Meta connection found for '${key}'. Connect via /auth/meta/login before calling Meta API tools.`,
    );
  }

  const timeRemainingMs = record.expiresAt - nowMs();
  if (timeRemainingMs > REFRESH_THRESHOLD_MS) {
    return record.accessToken;
  }

  if (timeRemainingMs <= 0) {
    logger.error({ key }, 'meta_token_expired');
    throw new Error(`Meta access token for '${key}' has expired. Reconnect via /auth/meta/login.`);
  }

  logger.info({ key, timeRemainingMs }, 'meta_token_refresh_started');
  const refreshed = await exchangeForLongLivedToken(record.accessToken);
  const updated: MetaTokenRecord = { ...record, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt, obtainedAt: nowMs() };
  await storeToken(updated);
  logger.info({ key, expiresAt: updated.expiresAt }, 'meta_token_refresh_succeeded');
  return updated.accessToken;
}

/** Resolves the single stored connection when the caller doesn't specify one explicitly. */
export async function getDefaultConnectionKey(): Promise<string> {
  const connections = await listConnections();
  if (connections.length === 0) {
    throw new Error('No Meta account connected yet. Visit /auth/meta/login to connect one.');
  }
  if (connections.length === 1) {
    return connections[0]!.key;
  }
  throw new Error(
    `Multiple Meta connections are stored (${connections.map((c) => c.key).join(', ')}). Specify which one to use.`,
  );
}
