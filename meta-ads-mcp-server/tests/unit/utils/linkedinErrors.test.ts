import { describe, expect, it } from 'vitest';
import {
  LinkedInApiError,
  classifyLinkedInErrorStatus,
  isRetryableLinkedInError,
  parseLinkedInApiError,
} from '../../../src/utils/linkedinErrors.js';

describe('linkedinErrors', () => {
  it('classifies 401 as expired_token', () => {
    expect(classifyLinkedInErrorStatus(401)).toBe('expired_token');
  });

  it('classifies 403 as permission', () => {
    expect(classifyLinkedInErrorStatus(403)).toBe('permission');
  });

  it('classifies 429 and 5xx as retryable', () => {
    expect(classifyLinkedInErrorStatus(429)).toBe('retryable');
    expect(classifyLinkedInErrorStatus(500)).toBe('retryable');
    expect(classifyLinkedInErrorStatus(503)).toBe('retryable');
  });

  it('classifies other 4xx as validation', () => {
    expect(classifyLinkedInErrorStatus(400)).toBe('validation');
    expect(classifyLinkedInErrorStatus(404)).toBe('validation');
  });

  it('classifies unrecognized statuses as unknown', () => {
    expect(classifyLinkedInErrorStatus(999)).toBe('unknown');
  });

  it('parseLinkedInApiError extracts message/status/serviceErrorCode from an Axios-shaped error', () => {
    const axiosLikeError = {
      response: {
        status: 429,
        data: { message: 'Too many requests', status: 429, serviceErrorCode: 100 },
        headers: { 'retry-after': '2', 'x-li-uuid': 'req-123' },
      },
    };
    const error = parseLinkedInApiError(axiosLikeError);
    expect(error).toBeInstanceOf(LinkedInApiError);
    expect(error.message).toBe('Too many requests');
    expect(error.status).toBe(429);
    expect(error.serviceErrorCode).toBe(100);
    expect(error.requestId).toBe('req-123');
    expect(error.retryAfterSeconds).toBe(2);
    expect(error.classification).toBe('retryable');
  });

  it('parseLinkedInApiError classifies a network timeout as retryable with status 0', () => {
    const error = parseLinkedInApiError({ code: 'ETIMEDOUT', message: 'timeout of 15000ms exceeded' });
    expect(error.status).toBe(0);
    expect(isRetryableLinkedInError(error)).toBe(true);
  });

  it('parseLinkedInApiError falls back to a generic error for an unrecognized shape', () => {
    const error = parseLinkedInApiError(new Error('boom'));
    expect(error.message).toBe('boom');
    expect(error.status).toBe(0);
  });

  it('isRetryableLinkedInError returns false for non-LinkedInApiError values', () => {
    expect(isRetryableLinkedInError(new Error('other'))).toBe(false);
    expect(isRetryableLinkedInError('nope')).toBe(false);
  });
});
