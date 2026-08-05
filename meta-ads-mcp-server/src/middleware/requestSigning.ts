import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
  }
}

/** Express `verify` hook for body parsers: captures the raw body for signature verification. */
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  req.rawBody = buf;
}

export function computeSignature(secret: string, payload: Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verifies an `X-Signature: sha256=<hex>` header against an HMAC-SHA256 of the
 * raw request body, for trusted server-to-server callers. A no-op (request
 * passes through unsigned) when REQUEST_SIGNING_SECRET is not configured, since
 * request signing is an opt-in hardening layer, not required for every deployment.
 */
export function requestSigningMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!env.REQUEST_SIGNING_SECRET) {
    next();
    return;
  }

  const header = req.headers['x-signature'];
  if (typeof header !== 'string' || !header.startsWith('sha256=')) {
    res.status(401).json({ success: false, message: 'Missing or malformed X-Signature header.' });
    return;
  }

  const provided = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = Buffer.from(computeSignature(env.REQUEST_SIGNING_SECRET, req.rawBody ?? Buffer.alloc(0)), 'hex');

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    logger.warn({ requestId: req.requestId, path: req.originalUrl }, 'request_signature_mismatch');
    res.status(401).json({ success: false, message: 'Invalid request signature.' });
    return;
  }

  next();
}
