import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { buildAuthorizationUrl, handleOAuthCallback } from '../auth/oauth.js';
import { computeSignature } from '../middleware/requestSigning.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Stateless CSRF state token: an HMAC-signed timestamp, verified for both
 * signature validity and freshness on callback. Avoids needing session/cookie
 * storage for a single-redirect OAuth flow.
 */
function createState(): string {
  const timestamp = Date.now().toString();
  const signature = computeSignature(env.MCP_JWT_SECRET, Buffer.from(timestamp));
  return `${timestamp}.${signature}`;
}

function isValidState(state: unknown): boolean {
  if (typeof state !== 'string') return false;
  const [timestamp, signature] = state.split('.');
  if (!timestamp || !signature) return false;

  const age = Date.now() - Number(timestamp);
  if (!Number.isFinite(age) || age < 0 || age > STATE_TTL_MS) return false;

  const expected = Buffer.from(computeSignature(env.MCP_JWT_SECRET, Buffer.from(timestamp)), 'hex');
  const provided = Buffer.from(signature, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export const oauthRouter = Router();

oauthRouter.get('/auth/meta/login', (_req, res) => {
  const state = createState();
  res.redirect(buildAuthorizationUrl(state));
});

oauthRouter.get('/auth/meta/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    logger.warn({ error, errorDescription }, 'meta_oauth_denied');
    res.status(400).json({
      success: false,
      message: typeof errorDescription === 'string' ? errorDescription : 'Meta authorization was denied.',
    });
    return;
  }

  if (typeof code !== 'string' || !isValidState(state)) {
    res.status(400).json({ success: false, message: 'Missing or invalid OAuth code/state.' });
    return;
  }

  try {
    const records = await handleOAuthCallback(code);
    res.json({
      success: true,
      message: 'Meta account connected. Use the connection key(s) below as `connectionKey` in MCP tool calls.',
      connections: records.map((record) => ({ key: record.key, businessName: record.businessName ?? null })),
    });
  } catch (err) {
    logger.error({ err }, 'meta_oauth_callback_failed');
    res.status(502).json({
      success: false,
      message: err instanceof Error ? err.message : 'Failed to complete Meta OAuth.',
    });
  }
});
