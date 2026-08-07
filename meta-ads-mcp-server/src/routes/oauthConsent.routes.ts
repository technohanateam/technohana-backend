import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getPendingAuthorization,
  deletePendingAuthorization,
  issueAuthorizationCode,
  getOAuthClient,
  type PendingAuthorization,
} from '../auth/mcpOAuthProvider.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Stricter than the app's global rate limiter (server.ts) - this endpoint
 * gates issuance of real OAuth authorization codes behind a shared password,
 * and Dynamic Client Registration is open by spec, so anyone who registers a
 * client can reach this form and attempt to guess it.
 */
const consentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timingSafePasswordEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    // Still run a comparison of matching length so the response time doesn't
    // leak whether the length alone was wrong.
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

function renderConsentForm(consentId: string, options: { clientName?: string; error?: string } = {}): string {
  const { clientName, error } = options;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Authorize access - meta-ads-mcp-server</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  p { color: #444; line-height: 1.5; }
  input[type="password"] { width: 100%; padding: 0.6rem; font-size: 1rem; box-sizing: border-box; margin: 0.75rem 0; }
  button { width: 100%; padding: 0.6rem; font-size: 1rem; cursor: pointer; }
  .error { color: #b91c1c; font-size: 0.9rem; }
</style>
</head>
<body>
  <h1>Authorize ${clientName ? escapeHtml(clientName) : 'this client'}</h1>
  <p>An application is requesting access to this Meta Ads MCP server. Enter the operator password to approve.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <form method="POST" action="/oauth/consent">
    <input type="hidden" name="consentId" value="${escapeHtml(consentId)}">
    <input type="password" name="password" placeholder="Operator password" autofocus required>
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
}

function renderExpiredPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Authorization expired</title></head>
<body>
  <h1>This authorization request has expired or was already used</h1>
  <p>Please restart the connection from your client (e.g. claude.ai's connector settings).</p>
</body>
</html>`;
}

export const oauthConsentRouter = Router();

/**
 * helmet()'s default CSP sets `form-action 'self'`, but 'self' resolves
 * against the DOCUMENT's own origin - and a document loaded in a sandboxed
 * iframe/popup without allow-same-origin (which is where claude.ai renders
 * this consent screen; see the Origin: null CORS handling in server.ts) has
 * an opaque origin, so 'self' can never match anything and the browser blocks
 * every submission outright. An explicit origin URL in form-action works
 * regardless of the document's own origin, so this route overrides just that
 * one directive rather than weakening the global CSP for the rest of the app.
 */
function setFormActionCsp(res: Response): void {
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self' ${env.MCP_OAUTH_ISSUER_URL};frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests`,
  );
}

oauthConsentRouter.get('/oauth/consent', async (req, res) => {
  setFormActionCsp(res);
  const consentId = typeof req.query.consentId === 'string' ? req.query.consentId : undefined;
  const pending = consentId ? await getPendingAuthorization(consentId) : null;
  if (!consentId || !pending) {
    res.status(400).type('html').send(renderExpiredPage());
    return;
  }
  const client = await getOAuthClient(pending.clientId);
  res.status(200).type('html').send(renderConsentForm(consentId, { clientName: client?.client_name }));
});

oauthConsentRouter.post(
  '/oauth/consent',
  consentRateLimiter,
  express.urlencoded({ extended: false }),
  async (req, res) => {
    const consentId = typeof req.body?.consentId === 'string' ? req.body.consentId : undefined;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const pending: PendingAuthorization | null = consentId ? await getPendingAuthorization(consentId) : null;
    if (!consentId || !pending) {
      res.status(400).type('html').send(renderExpiredPage());
      return;
    }

    if (!timingSafePasswordEqual(password, env.MCP_OAUTH_ADMIN_PASSWORD)) {
      logger.warn({ clientId: pending.clientId }, 'oauth_consent_wrong_password');
      const client = await getOAuthClient(pending.clientId);
      setFormActionCsp(res);
      res
        .status(401)
        .type('html')
        .send(renderConsentForm(consentId, { clientName: client?.client_name, error: 'Incorrect password. Try again.' }));
      return;
    }

    await deletePendingAuthorization(consentId);
    const code = await issueAuthorizationCode(pending);

    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (pending.state) {
      redirectUrl.searchParams.set('state', pending.state);
    }
    logger.info({ clientId: pending.clientId }, 'oauth_consent_approved');
    res.redirect(302, redirectUrl.href);
  },
);
