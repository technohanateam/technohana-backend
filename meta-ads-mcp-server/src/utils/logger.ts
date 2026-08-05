import pino from 'pino';
import { env } from '../config/env.js';

export interface ToolLogBindings {
  requestId: string;
  toolName?: string;
  userId?: string;
  accountId?: string;
  campaignId?: string;
  status?: 'success' | 'error';
  duration?: number;
  metaRequestId?: string;
}

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'meta-ads-mcp-server', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.accessToken',
      '*.access_token',
      '*.appSecret',
      '*.app_secret',
      '*.MCP_JWT_SECRET',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Creates a child logger pre-bound with per-call MCP tool context fields. */
export function createToolLogger(bindings: ToolLogBindings): pino.Logger {
  return logger.child(bindings);
}

export type Logger = pino.Logger;
