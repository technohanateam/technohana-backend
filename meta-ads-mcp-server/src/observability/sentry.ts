import * as Sentry from '@sentry/node';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let initialized = false;

/** Initializes Sentry error reporting when SENTRY_DSN is set. No-op otherwise. */
export function initSentry(): void {
  if (!env.SENTRY_DSN || initialized) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
  });
  initialized = true;
  logger.info('sentry_initialized');
}

/** Reports an error to Sentry when configured; always a no-op if SENTRY_DSN is unset. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!env.SENTRY_DSN) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
