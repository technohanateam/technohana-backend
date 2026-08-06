import request from 'supertest';
import type { Response } from 'supertest';
import { app } from '../../src/server.js';
import { issueMcpToken } from '../../src/auth/jwt.js';
import type { Role } from '../../src/config/roles.js';

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string };
}

/** The MCP transport replies with either a plain JSON body or a single SSE `data:` frame. */
export function parseMcpResponse<T = unknown>(res: Response): JsonRpcResponse<T> {
  if (res.type === 'text/event-stream' || (typeof res.text === 'string' && res.text.startsWith('event:'))) {
    const line = res.text.split('\n').find((l) => l.startsWith('data:'));
    if (!line) throw new Error(`No data: line found in SSE response: ${res.text}`);
    return JSON.parse(line.slice('data:'.length).trim());
  }
  return res.body as JsonRpcResponse<T>;
}

/** Issues a bearer token for `role` and completes the MCP initialize handshake, returning the session ID. */
export async function initMcpSession(role: Role = 'admin'): Promise<{ token: string; sessionId: string }> {
  const token = issueMcpToken({ sub: `test-${role}`, role });
  const res = await request(app)
    .post('/mcp')
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'vitest-integration', version: '1.0.0' },
      },
    });

  const sessionId = res.headers['mcp-session-id'];
  if (res.status !== 200 || !sessionId) {
    throw new Error(`Failed to initialize MCP session: status=${res.status} body=${JSON.stringify(res.body)}`);
  }
  return { token, sessionId };
}

export async function callTool(
  session: { token: string; sessionId: string },
  toolName: string,
  args: Record<string, unknown>,
): Promise<Response> {
  return request(app)
    .post('/mcp')
    .set('Authorization', `Bearer ${session.token}`)
    .set('mcp-session-id', session.sessionId)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } });
}
