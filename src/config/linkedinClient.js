import { encryptToken, decryptToken } from "../utils/tokenCrypto.js";
import CrmLinkedinConnection from "../models/crm/crmLinkedinConnection.model.js";

const API_BASE = "https://api.linkedin.com/rest";
const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const REFRESH_MARGIN_MS = 3 * 24 * 60 * 60 * 1000;

export class LinkedinNotConfiguredError extends Error {
  constructor(message = "LINKEDIN_CLIENT_ID/LINKEDIN_CLIENT_SECRET/LINKEDIN_REDIRECT_URI not configured") {
    super(message);
    this.code = "LINKEDIN_NOT_CONFIGURED";
  }
}

// Tokens revoked/expired beyond refresh — an admin must reconnect.
export class LinkedinAuthError extends Error {
  constructor(message) {
    super(message);
    this.code = "LINKEDIN_AUTH";
  }
}

export const getLinkedinScopes = () =>
  (process.env.LINKEDIN_OAUTH_SCOPES || "r_ads r_ads_reporting").split(/[\s,]+/).filter(Boolean);

const apiVersion = () => process.env.LINKEDIN_API_VERSION || "202405";

export const isLinkedinConfigured = () =>
  Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET && process.env.LINKEDIN_REDIRECT_URI);

function requireConfig() {
  const { LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI } = process.env;
  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET || !LINKEDIN_REDIRECT_URI) throw new LinkedinNotConfiguredError();
  return { clientId: LINKEDIN_CLIENT_ID, clientSecret: LINKEDIN_CLIENT_SECRET, redirectUri: LINKEDIN_REDIRECT_URI };
}

export function buildConsentUrl(state) {
  const { clientId, redirectUri } = requireConfig();
  const params = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: getLinkedinScopes().join(" "), state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error_description || json.error || `token request failed (${res.status})`;
    if (["invalid_grant", "invalid_client", "invalid_request"].includes(json.error)) throw new LinkedinAuthError(msg);
    throw new Error(`LinkedIn token error: ${msg}`);
  }
  return json;
}

export function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = requireConfig();
  return tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
}

// Shape stored in the connection: encrypted blob + plaintext expiry dates for status/refresh checks.
export function tokenFields(tokens, previous = {}) {
  const now = Date.now();
  const refreshToken = tokens.refresh_token || previous.refreshToken;
  return {
    encryptedTokens: encryptToken({ accessToken: tokens.access_token, refreshToken }),
    accessTokenExpiresAt: new Date(now + (tokens.expires_in || 5184000) * 1000),
    refreshTokenExpiresAt: tokens.refresh_token_expires_in
      ? new Date(now + tokens.refresh_token_expires_in * 1000)
      : previous.refreshTokenExpiresAt,
  };
}

// Returns a valid access token, refreshing (and persisting) it ~3 days before expiry.
export async function getAccessToken(connection) {
  const stored = decryptToken(connection.encryptedTokens);
  const expiresAt = connection.accessTokenExpiresAt?.getTime() || 0;
  if (stored.accessToken && expiresAt - REFRESH_MARGIN_MS > Date.now()) return stored.accessToken;

  const expired = expiresAt <= Date.now();
  if (!stored.refreshToken) {
    if (expired) await markDisconnected(connection, "LinkedIn access expired — reconnect");
    if (expired) throw new LinkedinAuthError("LinkedIn access expired");
    return stored.accessToken;
  }

  const { clientId, clientSecret } = requireConfig();
  try {
    const json = await tokenRequest({ grant_type: "refresh_token", refresh_token: stored.refreshToken, client_id: clientId, client_secret: clientSecret });
    const fields = tokenFields(json, { refreshToken: stored.refreshToken, refreshTokenExpiresAt: connection.refreshTokenExpiresAt });
    await CrmLinkedinConnection.updateOne({ _id: connection._id }, { $set: fields });
    connection.encryptedTokens = fields.encryptedTokens;
    connection.accessTokenExpiresAt = fields.accessTokenExpiresAt;
    return json.access_token;
  } catch (err) {
    if (err instanceof LinkedinAuthError) await markDisconnected(connection, "LinkedIn access was revoked — reconnect");
    else if (!expired) return stored.accessToken; // transient failure with a still-valid token
    throw err;
  }
}

const markDisconnected = (connection, message) =>
  CrmLinkedinConnection.updateOne({ _id: connection._id }, { isActive: false, lastSyncStatus: "error", lastSyncError: message });

// Parsed JSON; throws with `.status` on HTTP errors. 401 → LinkedinAuthError.
export async function linkedinFetch(connection, path, { params, headers } = {}) {
  const token = await getAccessToken(connection);
  const query = params ? `?${Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  const res = await fetch(`${API_BASE}${path}${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "LinkedIn-Version": apiVersion(),
      "X-Restli-Protocol-Version": "2.0.0",
      ...headers,
    },
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    await markDisconnected(connection, "LinkedIn rejected the access token — reconnect");
    throw new LinkedinAuthError("LinkedIn rejected the access token");
  }
  if (!res.ok) {
    const err = new Error(json?.message || `LinkedIn API error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const getActiveLinkedinConnection = () => CrmLinkedinConnection.findOne({ key: "default", isActive: true });
