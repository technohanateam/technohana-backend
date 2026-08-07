import axios from 'axios';
import { LINKEDIN_OAUTH_TOKEN_URL, STORAGE_NAMESPACES } from '../config/constants.js';
import { env } from '../config/env.js';
import { getStorageAdapter } from '../storage/storage.factory.js';
import { parseLinkedInApiError } from '../utils/linkedinErrors.js';
import { logger } from '../utils/logger.js';

/** LinkedIn access tokens are refreshed once fewer than this many ms remain. */
const REFRESH_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

export interface LinkedInTokenRecord {
  /** Storage key: the connected organization URN. */
  key: string;
  accessToken: string;
  refreshToken?: string;
  obtainedAt: number;
  /** Epoch ms. LinkedIn access tokens are typically valid ~60 days. */
  expiresAt: number;
  /** Epoch ms. LinkedIn refresh tokens are typically valid ~365 days. */
  refreshTokenExpiresAt?: number;
  scopes: string[];
  linkedinMemberId?: string;
  organizationUrn?: string;
  organizationName?: string;
}

interface LinkedInTokenExchangeResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

function nowMs(): number {
  return Date.now();
}

/** Exchanges an OAuth authorization code for an access + refresh token pair. */
export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  refreshTokenExpiresAt?: number;
}> {
  try {
    const response = await axios.post<LinkedInTokenExchangeResponse>(
      LINKEDIN_OAUTH_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: env.LINKEDIN_OAUTH_REDIRECT_URI,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return mapTokenExchangeResponse(response.data);
  } catch (error) {
    throw parseLinkedInApiError(error);
  }
}

/** Exchanges a stored refresh token for a new access token (and, per LinkedIn's rotation policy, a new refresh token). */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  refreshTokenExpiresAt?: number;
}> {
  try {
    const response = await axios.post<LinkedInTokenExchangeResponse>(
      LINKEDIN_OAUTH_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return mapTokenExchangeResponse(response.data);
  } catch (error) {
    throw parseLinkedInApiError(error);
  }
}

function mapTokenExchangeResponse(data: LinkedInTokenExchangeResponse): {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  refreshTokenExpiresAt?: number;
} {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: nowMs() + data.expires_in * 1000,
    refreshTokenExpiresAt:
      data.refresh_token_expires_in !== undefined ? nowMs() + data.refresh_token_expires_in * 1000 : undefined,
  };
}

export async function storeToken(record: LinkedInTokenRecord): Promise<void> {
  await getStorageAdapter().set(STORAGE_NAMESPACES.LINKEDIN_TOKENS, record.key, record);
}

export async function getToken(key: string): Promise<LinkedInTokenRecord | null> {
  return getStorageAdapter().get<LinkedInTokenRecord>(STORAGE_NAMESPACES.LINKEDIN_TOKENS, key);
}

export async function deleteToken(key: string): Promise<void> {
  await getStorageAdapter().delete(STORAGE_NAMESPACES.LINKEDIN_TOKENS, key);
}

export async function listConnections(): Promise<LinkedInTokenRecord[]> {
  const keys = await getStorageAdapter().listKeys(STORAGE_NAMESPACES.LINKEDIN_TOKENS);
  const records = await Promise.all(keys.map((key) => getToken(key)));
  return records.filter((record): record is LinkedInTokenRecord => record !== null);
}

/**
 * Returns a valid access token for `key`, transparently refreshing it first
 * (via the stored refresh token) if it is within REFRESH_THRESHOLD_MS of
 * expiry. Throws if no connection exists for `key`, or the access token has
 * expired and there is no usable refresh token to rotate it with.
 */
export async function getFreshAccessToken(key: string): Promise<string> {
  const record = await getToken(key);
  if (!record) {
    throw new Error(
      `No LinkedIn connection found for '${key}'. Connect via /auth/linkedin/login before calling LinkedIn Ads tools.`,
    );
  }

  const timeRemainingMs = record.expiresAt - nowMs();
  if (timeRemainingMs > REFRESH_THRESHOLD_MS) {
    return record.accessToken;
  }

  if (!record.refreshToken) {
    if (timeRemainingMs <= 0) {
      logger.error({ key }, 'linkedin_token_expired_no_refresh_token');
      throw new Error(`LinkedIn access token for '${key}' has expired and no refresh token is stored. Reconnect via /auth/linkedin/login.`);
    }
    return record.accessToken;
  }

  logger.info({ key, timeRemainingMs }, 'linkedin_token_refresh_started');
  const refreshed = await refreshAccessToken(record.refreshToken);
  const updated: LinkedInTokenRecord = {
    ...record,
    accessToken: refreshed.accessToken,
    // LinkedIn may rotate the refresh token itself on refresh; keep the old one only if a new one wasn't issued.
    refreshToken: refreshed.refreshToken ?? record.refreshToken,
    expiresAt: refreshed.expiresAt,
    refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt ?? record.refreshTokenExpiresAt,
    obtainedAt: nowMs(),
  };
  await storeToken(updated);
  logger.info({ key, expiresAt: updated.expiresAt }, 'linkedin_token_refresh_succeeded');
  return updated.accessToken;
}

/** Resolves the single stored connection when the caller doesn't specify one explicitly. */
export async function getDefaultConnectionKey(): Promise<string> {
  const connections = await listConnections();
  if (connections.length === 0) {
    throw new Error('No LinkedIn organization connected yet. Visit /auth/linkedin/login to connect one.');
  }
  if (connections.length === 1) {
    return connections[0]!.key;
  }
  throw new Error(
    `Multiple LinkedIn connections are stored (${connections.map((c) => c.key).join(', ')}). Specify which one to use.`,
  );
}
