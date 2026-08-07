import { randomUUID, randomBytes } from 'node:crypto';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { Response } from 'express';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
  OAUTH_PENDING_AUTHORIZATION_TTL_SECONDS,
  STORAGE_NAMESPACES,
} from '../config/constants.js';
import { env } from '../config/env.js';
import { getStorageAdapter } from '../storage/storage.factory.js';
import { issueMcpToken } from './jwt.js';
import { mcpTokenVerifier } from './mcpTokenVerifier.js';
import { logger } from '../utils/logger.js';

/**
 * This server has no user database - every successfully-authorized OAuth
 * client represents the single operator, so every issued token carries the
 * admin role. The interactive gate is the authorize() consent step (see
 * routes/oauthConsent.routes.ts), not a per-client role choice.
 */
const OPERATOR_ROLE = 'admin' as const;

export interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes?: string[];
  resource?: string;
}

interface AuthorizationCodeRecord {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource?: string;
}

async function getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
  const client = await getStorageAdapter().get<OAuthClientInformationFull>(STORAGE_NAMESPACES.OAUTH_CLIENTS, clientId);
  return client ?? undefined;
}

/** Looks up a registered client's metadata - used by the consent screen to show which app is requesting access. */
export const getOAuthClient = getClient;

const clientsStore: OAuthRegisteredClientsStore = {
  getClient,
  // The SDK's register handler already generates client_id/client_secret
  // before calling this - we just persist what we're given and hand it back.
  async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    await getStorageAdapter().set(STORAGE_NAMESPACES.OAUTH_CLIENTS, client.client_id, client);
    logger.info({ clientId: client.client_id, clientName: client.client_name }, 'oauth_client_registered');
    return client;
  },
};

/** Stores the OAuth params for a not-yet-approved authorization request, keyed by a fresh consentId the operator's browser is redirected to next. */
export async function createPendingAuthorization(pending: PendingAuthorization): Promise<string> {
  const consentId = randomUUID();
  await getStorageAdapter().set(
    STORAGE_NAMESPACES.OAUTH_PENDING_AUTHORIZATIONS,
    consentId,
    pending,
    OAUTH_PENDING_AUTHORIZATION_TTL_SECONDS,
  );
  return consentId;
}

export async function getPendingAuthorization(consentId: string): Promise<PendingAuthorization | null> {
  return getStorageAdapter().get<PendingAuthorization>(STORAGE_NAMESPACES.OAUTH_PENDING_AUTHORIZATIONS, consentId);
}

export async function deletePendingAuthorization(consentId: string): Promise<void> {
  await getStorageAdapter().delete(STORAGE_NAMESPACES.OAUTH_PENDING_AUTHORIZATIONS, consentId);
}

/** Issues a single-use authorization code for an approved pending authorization, and returns it. */
export async function issueAuthorizationCode(pending: PendingAuthorization): Promise<string> {
  const code = randomBytes(32).toString('hex');
  const record: AuthorizationCodeRecord = {
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
    resource: pending.resource,
  };
  await getStorageAdapter().set(STORAGE_NAMESPACES.OAUTH_CODES, code, record, OAUTH_AUTHORIZATION_CODE_TTL_SECONDS);
  return code;
}

async function getCode(code: string): Promise<AuthorizationCodeRecord | null> {
  return getStorageAdapter().get<AuthorizationCodeRecord>(STORAGE_NAMESPACES.OAUTH_CODES, code);
}

/**
 * OAuth 2.1 authorization server for the /mcp endpoint, so clients like
 * claude.ai's web connector setup (which requires Dynamic Client Registration
 * and a real authorize/token handshake, not just a static bearer token) can
 * connect. Tokens issued here are the exact same HS256 JWTs the `issue-token`
 * CLI script produces - verifyAccessToken and the rest of the app's RBAC/audit
 * layers don't need to know or care how a token was obtained.
 */
export const mcpOAuthProvider: OAuthServerProvider = {
  clientsStore,

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const consentId = await createPendingAuthorization({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes,
      resource: params.resource?.href,
    });
    res.redirect(302, `/oauth/consent?consentId=${encodeURIComponent(consentId)}`);
  },

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const record = await getCode(authorizationCode);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError('Authorization code is invalid, expired, or was issued to a different client.');
    }
    return record.codeChallenge;
  },

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const record = await getCode(authorizationCode);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError('Authorization code is invalid, expired, or was issued to a different client.');
    }
    if (redirectUri && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the one used to obtain this code.');
    }
    // Single-use: remove immediately so a replayed code can never be exchanged twice.
    await getStorageAdapter().delete(STORAGE_NAMESPACES.OAUTH_CODES, authorizationCode);

    const accessToken = issueMcpToken({ sub: client.client_id, role: OPERATOR_ROLE });
    logger.info({ clientId: client.client_id }, 'oauth_access_token_issued');
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: env.MCP_JWT_TTL_SECONDS,
    };
  },

  // This server issues long-lived access tokens (matching the CLI token model)
  // rather than short-lived-plus-refresh pairs, so no refresh_token is ever
  // handed out by exchangeAuthorizationCode - this should never legitimately
  // be called, but must still satisfy the interface.
  async exchangeRefreshToken(client: OAuthClientInformationFull): Promise<OAuthTokens> {
    throw new InvalidGrantError(
      `Client '${client.client_id}' has no refresh token - this server does not issue them. Re-run the authorization flow to obtain a new access token.`,
    );
  },

  // Identical to mcpTokenVerifier - tokens are the same HS256 JWTs regardless
  // of whether they came from this OAuth flow or the issue-token CLI script.
  verifyAccessToken: mcpTokenVerifier.verifyAccessToken,
};
