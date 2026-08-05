import { RETRY_DEFAULTS } from '../config/constants.js';
import { isRetryableError } from './metaErrors.js';
import type { Logger } from './logger.js';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  logger?: Logger;
  operationName?: string;
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

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      const isLastAttempt = attempt === maxAttempts;

      options.logger?.warn(
        {
          attempt,
          maxAttempts,
          retryable,
          operationName: options.operationName,
          err: error instanceof Error ? error.message : error,
        },
        retryable && !isLastAttempt ? 'Meta API call failed, retrying' : 'Meta API call failed',
      );

      if (!retryable || isLastAttempt) {
        throw error;
      }

      await sleep(computeDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio));
    }
  }

  throw lastError;
}
