import axios from 'axios';
import { env } from '../../config/env.js';
import { LINKEDIN_API_BASE_URL, LINKEDIN_RETRY_DEFAULTS } from '../../config/constants.js';
import { isRetryableLinkedInError, parseLinkedInApiError, type LinkedInApiError } from '../../utils/linkedinErrors.js';
import { withRetry } from '../../utils/retry.js';
import { linkedinRateLimitHitsTotal } from '../../observability/metrics.js';
import { logger } from '../../utils/logger.js';

const httpClient = axios.create({
  baseURL: LINKEDIN_API_BASE_URL,
  timeout: 15_000,
  headers: {
    'LinkedIn-Version': env.LINKEDIN_API_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  },
});

export interface LinkedInApiResult<T> {
  data: T;
  linkedinRequestId?: string;
}

interface BaseRequestConfig {
  accessToken: string;
  operationName: string;
  params?: Record<string, string | number | boolean | undefined>;
}

interface MutatingRequestConfig extends BaseRequestConfig {
  body?: Record<string, unknown>;
}

interface PatchRequestConfig extends BaseRequestConfig {
  /** LinkedIn partial-update payload, e.g. { patch: { $set: { status: 'PAUSED' } } }. */
  patch: Record<string, unknown>;
}

function extractLinkedInRequestId(headers: Record<string, unknown>): string | undefined {
  const value = headers['x-li-uuid'] ?? headers['X-LI-UUID'];
  return typeof value === 'string' ? value : undefined;
}

async function execute<T>(
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
  path: string,
  config: MutatingRequestConfig | PatchRequestConfig,
): Promise<LinkedInApiResult<T>> {
  return withRetry(
    async () => {
      try {
        const response = await httpClient.request<T>({
          method,
          url: path,
          params: config.params,
          headers: { Authorization: `Bearer ${config.accessToken}` },
          data: 'patch' in config ? config.patch : 'body' in config ? config.body : undefined,
        });
        return {
          data: response.data,
          linkedinRequestId: extractLinkedInRequestId(response.headers as Record<string, unknown>),
        };
      } catch (error) {
        throw parseLinkedInApiError(error);
      }
    },
    {
      logger,
      operationName: config.operationName,
      maxAttempts: LINKEDIN_RETRY_DEFAULTS.maxAttempts,
      baseDelayMs: LINKEDIN_RETRY_DEFAULTS.baseDelayMs,
      maxDelayMs: LINKEDIN_RETRY_DEFAULTS.maxDelayMs,
      jitterRatio: LINKEDIN_RETRY_DEFAULTS.jitterRatio,
      isRetryable: isRetryableLinkedInError,
      onRetry: () => linkedinRateLimitHitsTotal.inc(),
      retryAfterMs: (error) => {
        const retryAfterSeconds = (error as LinkedInApiError)?.retryAfterSeconds;
        return typeof retryAfterSeconds === 'number' ? retryAfterSeconds * 1000 : undefined;
      },
    },
  );
}

/** Thin, retrying, error-normalizing HTTP client for the LinkedIn Marketing (REST) API. */
export const linkedinClient = {
  get: <T>(path: string, config: BaseRequestConfig): Promise<LinkedInApiResult<T>> => execute<T>('GET', path, config),
  post: <T>(path: string, config: MutatingRequestConfig): Promise<LinkedInApiResult<T>> =>
    execute<T>('POST', path, config),
  patch: <T>(path: string, config: PatchRequestConfig): Promise<LinkedInApiResult<T>> =>
    execute<T>('PATCH', path, config),
  del: <T>(path: string, config: BaseRequestConfig): Promise<LinkedInApiResult<T>> => execute<T>('DELETE', path, config),
};
