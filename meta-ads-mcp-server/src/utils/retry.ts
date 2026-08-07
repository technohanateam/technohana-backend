import { RETRY_DEFAULTS } from '../config/constants.js';
import { isRetryableError } from './metaErrors.js';
import { metaRateLimitHitsTotal } from '../observability/metrics.js';
import type { Logger } from './logger.js';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  logger?: Logger;
  operationName?: string;
  /** Defaults to the Meta Graph API error classifier. Pass a provider-specific one to reuse this backoff loop elsewhere. */
  isRetryable?: (error: unknown) => boolean;
  /** Called once per retried attempt, after the retryability check passes. Defaults to incrementing the Meta rate-limit counter. */
  onRetry?: (error: unknown) => void;
  /** If the retryable error carries a server-specified wait (e.g. LinkedIn's Retry-After), use it instead of the computed backoff delay. */
  retryAfterMs?: (error: unknown) => number | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, jitterRatio: number): number {
  const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  const jitter = exponential * jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

/**
 * Executes `fn` with exponential backoff retry for transient Meta API errors
 * (rate limits, transient network errors). Non-retryable errors (expired token,
 * permission, validation) are rethrown immediately without retrying.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? RETRY_DEFAULTS.maxAttempts;
  const baseDelayMs = options.baseDelayMs ?? RETRY_DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? RETRY_DEFAULTS.maxDelayMs;
  const jitterRatio = options.jitterRatio ?? RETRY_DEFAULTS.jitterRatio;
  const isRetryable = options.isRetryable ?? isRetryableError;
  const onRetry = options.onRetry ?? (() => metaRateLimitHitsTotal.inc());

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error);
      const isLastAttempt = attempt === maxAttempts;

      options.logger?.warn(
        {
          attempt,
          maxAttempts,
          retryable,
          operationName: options.operationName,
          err: error instanceof Error ? error.message : error,
        },
        retryable && !isLastAttempt ? 'API call failed, retrying' : 'API call failed',
      );

      if (!retryable || isLastAttempt) {
        throw error;
      }

      onRetry(error);
      const serverDelayMs = options.retryAfterMs?.(error);
      await sleep(serverDelayMs ?? computeDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio));
    }
  }

  throw lastError;
}
