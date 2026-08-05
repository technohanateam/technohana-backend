import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/server.js';
import { issueMcpToken } from '../../src/auth/jwt.js';
import { initMcpSession, parseMcpResponse } from './mcpTestHelpers.js';

describe('MCP initialization', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(401);
  });

  it('rejects a request with a malformed bearer token', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(401);
  });

  it('completes the initialize handshake with a valid JWT and returns a session ID', async () => {
    const { sessionId } = await initMcpSession('admin');
    expect(sessionId).toBeTruthy();
  });

  it('reports the correct server name in the initialize result', async () => {
    const token = issueMcpToken({ sub: 'test-user', role: 'admin' });
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } },
      });
    const body = parseMcpResponse<{ serverInfo: { name: string } }>(res);
    expect(body.result?.serverInfo.name).toBe('meta-ads-mcp-server');
  });

  it('rejects a POST with a session ID that was never initialized', async () => {
    const token = issueMcpToken({ sub: 'test-user', role: 'admin' });
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('mcp-session-id', 'this-session-does-not-exist')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(res.status).toBe(400);
  });
});
