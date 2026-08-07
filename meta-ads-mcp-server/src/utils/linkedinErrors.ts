import type { AxiosError } from 'axios';
import {
  LINKEDIN_PERMISSION_ERROR_HTTP_STATUSES,
  LINKEDIN_RETRYABLE_HTTP_STATUSES,
  LINKEDIN_TOKEN_ERROR_HTTP_STATUSES,
} from '../config/constants.js';
import type { LinkedInApiErrorPayload } from '../types/linkedin.types.js';

export type LinkedInErrorClassification = 'expired_token' | 'permission' | 'retryable' | 'validation' | 'unknown';

export class LinkedInApiError extends Error {
  readonly status: number;
  readonly serviceErrorCode?: number;
  readonly requestId?: string;
  readonly classification: LinkedInErrorClassification;
  /** Seconds to wait before retrying, from a 429 response's Retry-After header. */
  readonly retryAfterSeconds?: number;

  constructor(payload: LinkedInApiErrorPayload, retryAfterSeconds?: number) {
    super(payload.message);
    this.name = 'LinkedInApiError';
    this.status = payload.status;
    this.serviceErrorCode = payload.serviceErrorCode;
    this.requestId = payload.requestId;
    this.retryAfterSeconds = retryAfterSeconds;
    this.classification = classifyLinkedInErrorStatus(payload.status);
  }
}

export function classifyLinkedInErrorStatus(status: number): LinkedInErrorClassification {
  if (LINKEDIN_TOKEN_ERROR_HTTP_STATUSES.has(status)) return 'expired_token';
  if (LINKEDIN_PERMISSION_ERROR_HTTP_STATUSES.has(status)) return 'permission';
  if (LINKEDIN_RETRYABLE_HTTP_STATUSES.has(status)) return 'retryable';
  if (status >= 400 && status < 500) return 'validation';
  return 'unknown';
}

interface LinkedInErrorResponseBody {
  message?: string;
  status?: number;
  serviceErrorCode?: number;
}

function parseRetryAfter(headers: Record<string, unknown> | undefined): number | undefined {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (typeof raw !== 'string') return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Parses an Axios error from a LinkedIn REST API call into a typed LinkedInApiError. */
export function parseLinkedInApiError(error: unknown): LinkedInApiError {
  const axiosError = error as AxiosError<LinkedInErrorResponseBody>;
  const body = axiosError?.response?.data;
  const httpStatus = axiosError?.response?.status;

  if (body && httpStatus) {
    return new LinkedInApiError(
      {
        message: body.message ?? 'Unknown LinkedIn API error',
        status: httpStatus,
        serviceErrorCode: body.serviceErrorCode,
        requestId:
          typeof axiosError.response?.headers?.['x-li-uuid'] === 'string'
            ? (axiosError.response.headers['x-li-uuid'] as string)
            : undefined,
      },
      parseRetryAfter(axiosError.response?.headers as Record<string, unknown> | undefined),
    );
  }

  if (axiosError?.code === 'ECONNABORTED' || axiosError?.code === 'ETIMEDOUT' || axiosError?.code === 'ECONNRESET') {
    return new LinkedInApiError({ message: axiosError.message, status: 0 });
  }

  return new LinkedInApiError({
    message: error instanceof Error ? error.message : 'Unknown error calling LinkedIn API',
    status: 0,
  });
}

export function isRetryableLinkedInError(error: unknown): boolean {
  if (error instanceof LinkedInApiError) {
    return error.classification === 'retryable' || error.status === 0;
  }
  return false;
}
