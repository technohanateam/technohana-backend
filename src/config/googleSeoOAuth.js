import { google } from "googleapis";
import { encryptToken, decryptToken } from "../utils/tokenCrypto.js";
import SeoConnection from "../models/seoConnection.model.js";

// Distinguishes "OAuth client not configured yet" from a real Google API
// failure — callers check `err.code === "SEO_GOOGLE_NOT_CONFIGURED"`.
export class SeoGoogleNotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.code = "SEO_GOOGLE_NOT_CONFIGURED";
  }
}

export const SEO_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];

let sharedClient = null;

// The shared client is only used to build the consent URL and to exchange
// the auth code on callback — it carries no per-connection credentials.
export function getSeoOAuthClient() {
  if (!sharedClient) {
    if (
      !process.env.SEO_GOOGLE_CLIENT_ID ||
      !process.env.SEO_GOOGLE_CLIENT_SECRET ||
      !process.env.SEO_GOOGLE_REDIRECT_URI
    ) {
      throw new SeoGoogleNotConfiguredError(
        "SEO_GOOGLE_CLIENT_ID/SEO_GOOGLE_CLIENT_SECRET/SEO_GOOGLE_REDIRECT_URI not configured"
      );
    }
    sharedClient = new google.auth.OAuth2(
      process.env.SEO_GOOGLE_CLIENT_ID,
      process.env.SEO_GOOGLE_CLIENT_SECRET,
      process.env.SEO_GOOGLE_REDIRECT_URI
    );
  }
  return sharedClient;
}

export function buildConsentUrl(state) {
  const client = getSeoOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SEO_OAUTH_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code) {
  const client = getSeoOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

// Builds a brand-new client rather than reusing/mutating the shared
// singleton — callers that need to attach credentials (e.g. after an OAuth
// exchange, or per stored connection) must never call setCredentials() on
// getSeoOAuthClient()'s return value, since concurrent requests share it.
export function createOAuthClient() {
  if (
    !process.env.SEO_GOOGLE_CLIENT_ID ||
    !process.env.SEO_GOOGLE_CLIENT_SECRET ||
    !process.env.SEO_GOOGLE_REDIRECT_URI
  ) {
    throw new SeoGoogleNotConfiguredError("SEO Google OAuth client not configured");
  }
  return new google.auth.OAuth2(
    process.env.SEO_GOOGLE_CLIENT_ID,
    process.env.SEO_GOOGLE_CLIENT_SECRET,
    process.env.SEO_GOOGLE_REDIRECT_URI
  );
}

// Multiple SeoConnection docs may exist (one per property, possibly across
// providers), each needing its own credentials set — build a fresh client
// per connection rather than mutating the shared singleton.
export async function getAuthedClientForConnection(connection) {
  const client = createOAuthClient();
  const { refreshToken } = decryptToken(connection.encryptedRefreshToken);
  client.setCredentials({ refresh_token: refreshToken });

  // Google occasionally rotates the refresh token when it issues a new
  // access token. If we never persist that, the old stored token can be
  // invalidated server-side and every future sync fails with no recovery
  // path. Persist a rotated token back onto this connection when supplied.
  client.on("tokens", (tokens) => {
    if (!tokens.refresh_token) return;
    SeoConnection.updateOne(
      { _id: connection._id },
      { $set: { encryptedRefreshToken: encryptRefreshToken(tokens.refresh_token) } }
    ).catch((err) => console.error(`[SeoConnection] failed to persist rotated refresh token for ${connection._id}:`, err.message));
  });

  return client;
}

export function encryptRefreshToken(refreshToken) {
  return encryptToken({ refreshToken });
}

export function decryptRefreshToken(connection) {
  return decryptToken(connection.encryptedRefreshToken).refreshToken;
}
