import { encryptToken, decryptToken } from "../utils/tokenCrypto.js";
import CrmZohoConnection from "../models/crm/crmZohoConnection.model.js";

export class ZohoNotConfiguredError extends Error {
  constructor(message = "ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET/ZOHO_REDIRECT_URI not configured") {
    super(message);
    this.code = "ZOHO_NOT_CONFIGURED";
  }
}

// Refresh token invalid/revoked — the rep must reconnect.
export class ZohoAuthError extends Error {
  constructor(message) {
    super(message);
    this.code = "ZOHO_AUTH";
  }
}

// Zoho Meeting's API needs the Professional plan — set ZOHO_MEETING_ENABLED=true only once that's active.
export const isMeetingEnabled = () => process.env.ZOHO_MEETING_ENABLED === "true";

export const getZohoScopes = () => [
  "ZohoMail.accounts.READ",
  "ZohoMail.messages.CREATE",
  "ZohoMail.messages.READ",
  "ZohoMail.folders.READ",
  ...(isMeetingEnabled()
    ? ["ZohoMeeting.meeting.CREATE", "ZohoMeeting.meeting.READ", "ZohoMeeting.recording.READ", "ZohoMeeting.manageOrg.READ"]
    : []),
];

const dc = () => process.env.ZOHO_DC || "in";
export const zohoHosts = () => ({
  accounts: `https://accounts.zoho.${dc()}`,
  mail: `https://mail.zoho.${dc()}`,
  meeting: `https://meeting.zoho.${dc()}`,
});

function requireConfig() {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI } = process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REDIRECT_URI) throw new ZohoNotConfiguredError();
  return { clientId: ZOHO_CLIENT_ID, clientSecret: ZOHO_CLIENT_SECRET, redirectUri: ZOHO_REDIRECT_URI };
}

export const isZohoConfigured = () =>
  Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REDIRECT_URI);

export function buildConsentUrl(state) {
  const { clientId, redirectUri } = requireConfig();
  const params = new URLSearchParams({
    scope: getZohoScopes().join(","),
    client_id: clientId,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    redirect_uri: redirectUri,
    state,
  });
  return `${zohoHosts().accounts}/oauth/v2/auth?${params}`;
}

async function tokenRequest(params) {
  const res = await fetch(`${zohoHosts().accounts}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error || `token request failed (${res.status})`;
    if (msg === "invalid_code" || msg === "invalid_client" || msg === "invalid_token") throw new ZohoAuthError(msg);
    throw new Error(`Zoho token error: ${msg}`);
  }
  return json;
}

export function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = requireConfig();
  return tokenRequest({
    grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
  });
}

export async function revokeRefreshToken(refreshToken) {
  await fetch(`${zohoHosts().accounts}/oauth/v2/token/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" });
}

export const encryptRefreshToken = (refreshToken) => encryptToken({ refreshToken });
export const decryptRefreshToken = (connection) => decryptToken(connection.encryptedRefreshToken).refreshToken;

// Access tokens last ~1h; cache per connection so a poll cycle doesn't hit the token endpoint each call.
const accessCache = new Map();

export async function getAccessToken(connection) {
  const key = String(connection._id);
  const cached = accessCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const { clientId, clientSecret } = requireConfig();
  let json;
  try {
    json = await tokenRequest({
      grant_type: "refresh_token", refresh_token: decryptRefreshToken(connection), client_id: clientId, client_secret: clientSecret,
    });
  } catch (err) {
    if (err instanceof ZohoAuthError) {
      await CrmZohoConnection.updateOne({ _id: connection._id }, { isActive: false, lastSyncStatus: "error", lastSyncError: "Zoho access was revoked — reconnect" });
      accessCache.delete(key);
    }
    throw err;
  }
  accessCache.set(key, { token: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 });
  return json.access_token;
}

export function clearAccessCache(connection) {
  accessCache.delete(String(connection._id));
}

// service: "mail" | "meeting". Returns parsed JSON; throws with `.status` on HTTP errors.
export async function zohoFetch(connection, service, path, { method = "GET", body } = {}) {
  const token = await getAccessToken(connection);
  const res = await fetch(`${zohoHosts()[service]}${path}`, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearAccessCache(connection);
    throw new ZohoAuthError("Zoho rejected the access token");
  }
  if (!res.ok) {
    const err = new Error(json?.data?.moreInfo || json?.status?.description || json?.message || `Zoho ${service} error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}
