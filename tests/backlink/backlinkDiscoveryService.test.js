import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import SeoOpportunity from "../../src/models/seoOpportunity.model.js";
import SeoSettings from "../../src/models/seoSettings.model.js";
import { clearRobotsCache } from "../../src/utils/robotsCache.js";
import { clearRateLimiterState } from "../../src/utils/domainRateLimiter.js";
import {
  proposeDiscoveryCandidates,
  extractContactEmail,
  fetchAndScoreCandidate,
  runDiscoveryBatch,
} from "../../src/services/backlinkDiscoveryService.js";

beforeEach(() => {
  clearRobotsCache();
  clearRateLimiterState();
  mock.restoreAll();
  mock.method(SeoSettings, "findOne", () => ({ lean: async () => null }));
});

test("proposeDiscoveryCandidates parses and caps the AI response", async () => {
  const fakeCandidates = Array.from({ length: 20 }, (_, i) => ({
    domain: `example${i}.com`,
    organizationName: `Example ${i}`,
    opportunityType: "resource page",
    rationale: "test",
  }));
  const callClaudeFn = mock.fn(async () => ({ text: JSON.stringify(fakeCandidates) }));
  const extractJsonFn = mock.fn((text) => JSON.parse(text));

  const result = await proposeDiscoveryCandidates({ category: "education-directories", count: 5, callClaudeFn, extractJsonFn });

  assert.equal(result.length, 5);
  assert.equal(callClaudeFn.mock.callCount(), 1);
});

test("proposeDiscoveryCandidates throws on a non-array AI response", async () => {
  const callClaudeFn = async () => ({ text: "not json array" });
  const extractJsonFn = () => ({ not: "an array" });

  await assert.rejects(() => proposeDiscoveryCandidates({ category: "x", callClaudeFn, extractJsonFn }));
});

test("proposeDiscoveryCandidates drops malformed candidates missing a domain", async () => {
  const callClaudeFn = async () => ({ text: "[]" });
  const extractJsonFn = () => [{ organizationName: "No domain here" }, { domain: "good.com" }];

  const result = await proposeDiscoveryCandidates({ category: "x", callClaudeFn, extractJsonFn });
  assert.equal(result.length, 1);
  assert.equal(result[0].domain, "good.com");
});

test("extractContactEmail finds a mailto link first", () => {
  const html = `<a href="mailto:hello@example.com?subject=hi">Contact</a> or email random@nowhere.com in text`;
  assert.equal(extractContactEmail(html), "hello@example.com");
});

test("extractContactEmail falls back to a bare email pattern in the body", () => {
  const html = `<p>Reach us at partnerships@example.org for details.</p>`;
  assert.equal(extractContactEmail(html), "partnerships@example.org");
});

test("fetchAndScoreCandidate skips a domain already discovered (sourceKey dedup)", async () => {
  mock.method(SeoOpportunity, "findOne", () => ({ lean: async () => ({ _id: "existing" }) }));
  const createSpy = mock.method(SeoOpportunity, "create", async () => ({}));

  const result = await fetchAndScoreCandidate({ domain: "known.com", category: "cat", opportunityType: "directory", organizationName: "Known" });

  assert.equal(result.skipped, true);
  assert.equal(createSpy.mock.callCount(), 0);
});

test("fetchAndScoreCandidate records robots-disallowed candidates without fetching contact pages", async () => {
  mock.method(SeoOpportunity, "findOne", () => ({ lean: async () => null }));
  const createSpy = mock.method(SeoOpportunity, "create", async (doc) => doc);
  mock.method(axios, "get", async (url) => {
    if (url.endsWith("/robots.txt")) return { status: 200, data: "User-agent: *\nDisallow: /\n" };
    throw new Error("should not fetch a disallowed contact page");
  });

  const result = await fetchAndScoreCandidate({ domain: "blocked.com", category: "cat", opportunityType: "directory", organizationName: "Blocked" });

  assert.equal(result.fetched, false);
  assert.equal(createSpy.mock.callCount(), 1);
  assert.equal(createSpy.mock.calls[0].arguments[0].robotsAllowed, false);
});

test("fetchAndScoreCandidate extracts a contact email and assigns high confidence", async () => {
  mock.method(SeoOpportunity, "findOne", () => ({ lean: async () => null }));
  const createSpy = mock.method(SeoOpportunity, "create", async (doc) => doc);
  mock.method(axios, "get", async (url) => {
    if (url.endsWith("/robots.txt")) return { status: 200, data: "User-agent: *\nAllow: /\n" };
    if (url.endsWith("/contact")) return { status: 200, data: `<a href="mailto:hi@good.com">Contact</a>` };
    return { status: 404, data: "" };
  });

  const result = await fetchAndScoreCandidate({ domain: "good.com", category: "cat", opportunityType: "directory", organizationName: "Good" });

  assert.equal(result.fetched, true);
  const doc = createSpy.mock.calls[0].arguments[0];
  assert.equal(doc.contactEmail, "hi@good.com");
  assert.equal(doc.confidence, "High");
  assert.equal(doc.discoverySource, "ai-seed");
});

test("runDiscoveryBatch aggregates proposed/created/skipped/error counts across categories", async () => {
  mock.method(SeoOpportunity, "findOne", () => ({ lean: async () => null }));
  mock.method(SeoOpportunity, "create", async (doc) => doc);
  mock.method(axios, "get", async (url) => {
    if (url.endsWith("/robots.txt")) return { status: 200, data: "User-agent: *\nDisallow: /\n" }; // skip contact fetch, still "created"
    throw new Error("unexpected fetch");
  });

  const proposeFn = mock.fn(async ({ category }) => [
    { domain: `${category}-a.com`, organizationName: "A", opportunityType: "directory", rationale: "r" },
    { domain: `${category}-b.com`, organizationName: "B", opportunityType: "directory", rationale: "r" },
  ]);

  const summary = await runDiscoveryBatch({ categories: ["cat1", "cat2"], proposeFn });

  assert.equal(proposeFn.mock.callCount(), 2);
  assert.equal(summary.proposed, 4);
  assert.equal(summary.created, 4);
  assert.equal(summary.errors, 0);
});

test("runDiscoveryBatch counts an AI proposal failure as an error and continues to the next category", async () => {
  mock.method(SeoOpportunity, "findOne", () => ({ lean: async () => null }));
  mock.method(SeoOpportunity, "create", async (doc) => doc);
  mock.method(axios, "get", async (url) => ({ status: 200, data: "User-agent: *\nDisallow: /\n" }));

  const proposeFn = mock.fn(async ({ category }) => {
    if (category === "bad") throw new Error("AI down");
    return [{ domain: "ok.com", organizationName: "Ok", opportunityType: "directory", rationale: "r" }];
  });

  const summary = await runDiscoveryBatch({ categories: ["bad", "good"], proposeFn });

  assert.equal(summary.errors, 1);
  assert.equal(summary.created, 1);
});
