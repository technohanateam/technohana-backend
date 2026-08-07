import { createHmac } from 'node:crypto';
import type { Request, Response } from 'express';

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
