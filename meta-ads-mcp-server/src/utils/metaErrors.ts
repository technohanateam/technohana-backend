import type { AxiosError } from 'axios';
import {
  META_PERMISSION_ERROR_CODES,
  META_RETRYABLE_ERROR_CODES,
  META_TOKEN_ERROR_CODES,
} from '../config/constants.js';
import type { MetaApiErrorPayload } from '../types/meta.types.js';

export type MetaErrorClassification = 'expired_token' | 'permission' | 'retryable' | 'validation' | 'unknown';

export class MetaApiError extends Error {
  readonly code: number;
  readonly errorSubcode?: number;
  readonly type: string;
  readonly fbtraceId?: string;
  readonly classification: MetaErrorClassification;
  readonly httpStatus?: number;

  constructor(payload: MetaApiErrorPayload, httpStatus?: number) {
    super(payload.message);
    this.name = 'MetaApiError';
    this.code = payload.code;
    this.errorSubcode = payload.errorSubcode;
    this.type = payload.type;
    this.fbtraceId = payload.fbtraceId;
    this.httpStatus = httpStatus;
    this.classification = classifyMetaErrorCode(payload.code);
  }
}

export function classifyMetaErrorCode(code: number): MetaErrorClassification {
  if (META_TOKEN_ERROR_CODES.has(code)) return 'expired_token';
  if (META_PERMISSION_ERROR_CODES.has(code)) return 'permission';
  if (META_RETRYABLE_ERROR_CODES.has(code)) return 'retryable';
  return 'unknown';
}

interface MetaGraphErrorResponseBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/** Parses an Axios error from a Meta Graph API call into a typed MetaApiError. */
export function parseMetaApiError(error: unknown): MetaApiError {
  const axiosError = error as AxiosError<MetaGraphErrorResponseBody>;
  const body = axiosError?.response?.data?.error;

  if (body) {
    return new MetaApiError(
      {
        message: body.message ?? 'Unknown Meta API error',
        type: body.type ?? 'Unknown',
        code: body.code ?? -1,
        errorSubcode: body.error_subcode,
        fbtraceId: body.fbtrace_id,
      },
      axiosError.response?.status,
    );
  }

  if (axiosError?.code === 'ECONNABORTED' || axiosError?.code === 'ETIMEDOUT' || axiosError?.code === 'ECONNRESET') {
    return new MetaApiError({ message: axiosError.message, type: 'NetworkError', code: -2 });
  }

  return new MetaApiError({
    message: error instanceof Error ? error.message : 'Unknown error calling Meta API',
    type: 'Unknown',
    code: -1,
  });
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof MetaApiError) {
    return error.classification === 'retryable' || error.code === -2;
  }
  return false;
}
