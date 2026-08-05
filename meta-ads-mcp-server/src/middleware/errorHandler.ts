import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { MetaApiError } from '../utils/metaErrors.js';
import { logger } from '../utils/logger.js';
import { captureException } from '../observability/sentry.js';

/** 404 handler for the small REST surface (health/ready/metrics/oauth). */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ success: false, message: `No route for ${req.method} ${req.originalUrl}` });
}

/**
 * Central Express error normalizer. Never leaks stack traces or internal error
 * details to the client, regardless of source (Zod validation, Meta API, generic).
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId;

  if (err instanceof ZodError) {
    logger.warn({ requestId, issues: err.issues }, 'request_validation_error');
    res.status(400).json({
      success: false,
      message: 'Invalid request.',
      errors: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }

  if (err instanceof MetaApiError) {
    const statusByClassification: Record<string, number> = {
      expired_token: 401,
      permission: 403,
      validation: 400,
      retryable: 503,
      unknown: 502,
    };
    logger.error(
      { requestId, code: err.code, classification: err.classification, fbtraceId: err.fbtraceId },
      'meta_api_error',
    );
    res.status(statusByClassification[err.classification] ?? 502).json({
      success: false,
      message: err.message,
      metaErrorCode: err.code,
    });
    return;
  }

  logger.error(
    { requestId, err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
    'unhandled_error',
  );
  captureException(err, { requestId, path: req.originalUrl });

  res.status(500).json({
    success: false,
    message: env.NODE_ENV === 'production' ? 'Internal server error.' : (err as Error)?.message ?? 'Internal server error.',
  });
}
