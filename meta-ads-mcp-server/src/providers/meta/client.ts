import axios from 'axios';
import { META_GRAPH_BASE_URL } from '../../config/constants.js';
import { parseMetaApiError } from '../../utils/metaErrors.js';
import { withRetry } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';

const httpClient = axios.create({ baseURL: META_GRAPH_BASE_URL, timeout: 15_000 });

export interface MetaApiResult<T> {
  data: T;
  metaRequestId?: string;
}

interface BaseRequestConfig {
  accessToken: string;
  operationName: string;
  params?: Record<string, string | number | boolean | undefined>;
}

interface MutatingRequestConfig extends BaseRequestConfig {
  body?: Record<string, unknown>;
}

/** Converts a field map into a Graph-API-compatible form body, JSON-encoding non-primitive values. */
function toFormBody(body: Record<string, unknown> | undefined): URLSearchParams {
  const form = new URLSearchParams();
  if (!body) return form;
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return form;
}

function extractMetaRequestId(headers: Record<string, unknown>): string | undefined {
  const value = headers['x-fb-trace-id'] ?? headers['X-FB-Trace-Id'];
  return typeof value === 'string' ? value : undefined;
}

async function execute<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  config: MutatingRequestConfig,
): Promise<MetaApiResult<T>> {
  return withRetry(
    async () => {
      try {
        const response = await httpClient.request<T>({
          method,
          url: path,
          params: { ...config.params, access_token: config.accessToken },
          data: method === 'POST' ? toFormBody(config.body) : undefined,
        });
        return {
          data: response.data,
          metaRequestId: extractMetaRequestId(response.headers as Record<string, unknown>),
        };
      } catch (error) {
        throw parseMetaApiError(error);
      }
    },
    { logger, operationName: config.operationName },
  );
}

/** Thin, retrying, error-normalizing HTTP client for the Meta Graph Marketing API. */
export const metaClient = {
  get: <T>(path: string, config: BaseRequestConfig): Promise<MetaApiResult<T>> => execute<T>('GET', path, config),
  post: <T>(path: string, config: MutatingRequestConfig): Promise<MetaApiResult<T>> =>
    execute<T>('POST', path, config),
  del: <T>(path: string, config: BaseRequestConfig): Promise<MetaApiResult<T>> => execute<T>('DELETE', path, config),
};
