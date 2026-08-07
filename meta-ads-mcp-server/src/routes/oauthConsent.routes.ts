import { randomBytes, timingSafeEqual } from 'node:crypto';
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

function renderConsentForm(consentId: string, nonce: string, options: { clientName?: string; error?: string } = {}): string {
  const { clientName, error } = options;
  // Submission goes through fetch() + JS-driven navigation, not a native
  // <form> POST. claude.ai renders this page inside a sandboxed iframe/popup
  // (confirmed live: Origin: null on requests from it, an opaque document
  // origin), and browsers block native form submissions from a sandbox
  // lacking `allow-forms` independently of any CSP header - `form-action`
  // tweaks can't override that. `allow-scripts` is required for this page to
  // do anything interactive at all, so a fetch()-based submission works where
  // a native form can't.
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
  button:disabled { opacity: 0.6; cursor: default; }
  .error { color: #b91c1c; font-size: 0.9rem; }
</style>
</head>
<body>
  <h1>Authorize ${clientName ? escapeHtml(clientName) : 'this client'}</h1>
  <p>An application is requesting access to this Meta Ads MCP server. Enter the operator password to approve.</p>
  <p class="error" id="error"${error ? '' : ' style="display:none"'}>${error ? escapeHtml(error) : ''}</p>
  <form id="consent-form">
    <input type="hidden" id="consentId" value="${escapeHtml(consentId)}">
    <input type="password" id="password" placeholder="Operator password" autofocus required>
    <button type="submit" id="submit-btn">Authorize</button>
  </form>
  <script nonce="${nonce}">
    document.getElementById('consent-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var btn = document.getElementById('submit-btn');
      var errorEl = document.getElementById('error');
      btn.disabled = true;
      btn.textContent = 'Authorizing...';
      try {
        var res = await fetch('/oauth/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            consentId: document.getElementById('consentId').value,
            password: document.getElementById('password').value,
          }),
        });
        var data = await res.json();
        if (res.ok && data.redirectUrl) {
          window.location.href = data.redirectUrl;
          return;
        }
        errorEl.textContent = data.message || 'Something went wrong. Please try again.';
        errorEl.style.display = '';
      } catch (err) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.style.display = '';
      }
      btn.disabled = false;
      btn.textContent = 'Authorize';
    });
  </script>
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
 * Sets this page's CSP with a fresh per-response nonce for its one inline
 * <script> block (submission is fetch()-based, not a native form POST - see
 * renderConsentForm for why), and returns that nonce so the caller can tag
 * the <script> tag with it. 'unsafe-inline' is deliberately not used here;
 * a nonce only authorizes the exact script emitted for this one response.
 */
function setConsentCsp(res: Response): string {
  const nonce = randomBytes(16).toString('base64');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self' ${env.MCP_OAUTH_ISSUER_URL};frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self' 'nonce-${nonce}';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';connect-src 'self';upgrade-insecure-requests`,
  );
  return nonce;
}

oauthConsentRouter.get('/oauth/consent', async (req, res) => {
  const nonce = setConsentCsp(res);
  const consentId = typeof req.query.consentId === 'string' ? req.query.consentId : undefined;
  const pending = consentId ? await getPendingAuthorization(consentId) : null;
  if (!consentId || !pending) {
    res.status(400).type('html').send(renderExpiredPage());
    return;
  }
  const client = await getOAuthClient(pending.clientId);
  res.status(200).type('html').send(renderConsentForm(consentId, nonce, { clientName: client?.client_name }));
});

// The page's own <script> submits here via fetch() (see renderConsentForm),
// not a native form POST, so this returns JSON rather than an HTML
// re-render/redirect - the client-side script drives navigation on success.
oauthConsentRouter.post(
  '/oauth/consent',
  consentRateLimiter,
  express.json(),
  async (req, res) => {
    const consentId = typeof req.body?.consentId === 'string' ? req.body.consentId : undefined;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const pending: PendingAuthorization | null = consentId ? await getPendingAuthorization(consentId) : null;
    if (!consentId || !pending) {
      res.status(400).json({ message: 'This authorization request has expired or was already used. Please restart the connection from your client.' });
      return;
    }

    if (!timingSafePasswordEqual(password, env.MCP_OAUTH_ADMIN_PASSWORD)) {
      logger.warn({ clientId: pending.clientId }, 'oauth_consent_wrong_password');
      res.status(401).json({ message: 'Incorrect password. Try again.' });
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
    res.status(200).json({ redirectUrl: redirectUrl.href });
  },
);
