import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { throttledFetch, clearRateLimiterState } from "../../src/utils/domainRateLimiter.js";

beforeEach(() => {
  clearRateLimiterState();
  mock.restoreAll();
});

test("does not delay the first request to a domain", async () => {
  mock.method(axios, "get", async () => ({ status: 200, data: "ok" }));

  const start = Date.now();
  await throttledFetch("https://example.com/a", {}, { minIntervalMs: 200 });
  assert.ok(Date.now() - start < 100);
});

test("delays a second request to the same domain by the minimum interval", async () => {
  mock.method(axios, "get", async () => ({ status: 200, data: "ok" }));

  await throttledFetch("https://example.com/a", {}, { minIntervalMs: 150 });
  const start = Date.now();
  await throttledFetch("https://example.com/b", {}, { minIntervalMs: 150 });
  assert.ok(Date.now() - start >= 130); // small tolerance
});

test("does not delay requests to a different domain", async () => {
  mock.method(axios, "get", async () => ({ status: 200, data: "ok" }));

  await throttledFetch("https://example.com/a", {}, { minIntervalMs: 500 });
  const start = Date.now();
  await throttledFetch("https://other.com/a", {}, { minIntervalMs: 500 });
  assert.ok(Date.now() - start < 100);
});
