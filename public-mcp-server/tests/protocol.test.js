import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { installFakeDb } from './fakeDb.js';
import { refreshPriceCatalog } from '../../src/utils/pricing.js';
import { createApp } from '../app.js';
import { TOOL_NAMES } from '../registry.js';

let db;
let httpServer;
let base;

before(async () => {
  db = installFakeDb();
  await refreshPriceCatalog();
  httpServer = createApp({ requestLimit: 1000, couponLimit: 3 }).listen(0);
  await new Promise((r) => httpServer.once('listening', r));
  base = `http://127.0.0.1:${httpServer.address().port}`;
});

after(() => {
  httpServer.close();
  db.restore();
});

async function withClient(fn) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test('tools/list exposes exactly the four approved tools, all read-only', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
    for (const t of tools) {
      assert.ok(t.title, `${t.name} has a title`);
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} readOnlyHint`);
      assert.equal(t.annotations?.destructiveHint, false, `${t.name} destructiveHint`);
      assert.equal(t.inputSchema.additionalProperties, false, `${t.name} rejects extra fields`);
    }
  });
});

test('search_courses returns structured results', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({ name: 'search_courses', arguments: { category: 'Atlassian' } });
    assert.ok(!res.isError);
    assert.deepEqual(res.structuredContent.courses.map((c) => c.id).sort(), ['confluence-pro', 'jira-fundamentals']);
  });
});

test('get_group_quote returns a USD quote', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({ name: 'get_group_quote', arguments: { courseId: 'jira-fundamentals', participants: 10 } });
    assert.equal(res.structuredContent.groupDiscountPercent, 35);
    assert.equal(res.structuredContent.total, 650);
  });
});

test('invalid input is rejected', async () => {
  await withClient(async (client) => {
    const bad = [
      { name: 'get_group_quote', arguments: { courseId: 'jira-fundamentals', participants: 1 } },
      { name: 'get_group_quote', arguments: { courseId: 'jira-fundamentals', participants: 51 } },
      { name: 'get_price_quote', arguments: { courseId: 'jira-fundamentals', currency: 'inr' } },
      { name: 'search_courses', arguments: { limit: 500 } },
      { name: 'get_course_details', arguments: { courseId: { $ne: null } } },
      { name: 'get_price_quote', arguments: { courseId: 'jira-fundamentals', couponCode: 'a b;$' } },
    ];
    for (const call of bad) {
      const res = await client.callTool(call).catch((err) => ({ isError: true, err }));
      assert.equal(res.isError, true, JSON.stringify(call));
    }
  });
});

test('unknown tools cannot be called', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({ name: 'delete_campaign', arguments: {} }).catch(() => ({ isError: true }));
    assert.equal(res.isError, true);
  });
});

test('unknown course gives a safe error without internals', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({ name: 'get_course_details', arguments: { courseId: 'playbook-secret' } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Course not found/);
  });
});

test('a course without a USD price gives a clear message', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({ name: 'get_price_quote', arguments: { courseId: 'no-usd' } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /USD price is not published/);
  });
});

test('only /mcp and /health are routable, and /mcp is POST-only', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(`${base}/admin/courses`)).status, 404);
  assert.equal((await fetch(`${base}/pricing/quote`, { method: 'POST' })).status, 404);
});

test('malformed JSON is rejected without a stack trace', async () => {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
  assert.ok(!(await res.text()).includes('at '));
});

test('coupon-bearing calls are rate limited more strictly', async () => {
  const call = (id) => fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'get_price_quote', arguments: { courseId: 'jira-fundamentals', couponCode: 'SAVE10' } } }),
  });
  const statuses = [];
  for (let i = 1; i <= 5; i += 1) statuses.push((await call(i)).status);
  assert.ok(statuses.includes(429), `expected a 429 in ${statuses}`);
  assert.equal(statuses[0], 200);
});
