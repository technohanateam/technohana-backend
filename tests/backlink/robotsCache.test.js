import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { isFetchAllowed, clearRobotsCache } from "../../src/utils/robotsCache.js";

beforeEach(() => {
  clearRobotsCache();
  mock.restoreAll();
});

test("disallows a path blocked by robots.txt", async () => {
  mock.method(axios, "get", async () => ({
    status: 200,
    data: "User-agent: *\nDisallow: /private/\n",
  }));

  const allowed = await isFetchAllowed("https://example.com/private/page", "TestBot/1.0");
  assert.equal(allowed, false);
});

test("allows a path not blocked by robots.txt", async () => {
  mock.method(axios, "get", async () => ({
    status: 200,
    data: "User-agent: *\nDisallow: /private/\n",
  }));

  const allowed = await isFetchAllowed("https://example.com/contact", "TestBot/1.0");
  assert.equal(allowed, true);
});

test("defaults to allow when robots.txt fetch fails", async () => {
  mock.method(axios, "get", async () => {
    throw new Error("network error");
  });

  const allowed = await isFetchAllowed("https://example.com/contact", "TestBot/1.0");
  assert.equal(allowed, true);
});

test("defaults to allow on a 404 robots.txt", async () => {
  mock.method(axios, "get", async () => ({ status: 404, data: "" }));

  const allowed = await isFetchAllowed("https://example.com/contact", "TestBot/1.0");
  assert.equal(allowed, true);
});

test("caches the parser across repeated calls to the same host", async () => {
  let calls = 0;
  mock.method(axios, "get", async () => {
    calls += 1;
    return { status: 200, data: "User-agent: *\nAllow: /\n" };
  });

  await isFetchAllowed("https://example.com/a", "TestBot/1.0");
  await isFetchAllowed("https://example.com/b", "TestBot/1.0");
  assert.equal(calls, 1);
});
