import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import SeoOpportunity from "../../src/models/seoOpportunity.model.js";
import SeoMonitoring from "../../src/models/seoMonitoring.model.js";
import { importCompetitorBacklinkCsv, normalizeDomain } from "../../src/services/backlinkCompetitorGapService.js";

beforeEach(() => {
  mock.restoreAll();
});

test("normalizeDomain strips protocol, www, and path", () => {
  assert.equal(normalizeDomain("https://www.Example.com/blog/post"), "example.com");
  assert.equal(normalizeDomain("example.org"), "example.org");
  assert.equal(normalizeDomain(""), "");
});

test("finds only domains that link to the competitor but not to Technohana", async () => {
  mock.method(SeoMonitoring, "find", () => ({ distinct: async () => ["already-linking.com", "www.also-linking.com"] }));
  mock.method(SeoOpportunity, "findOne", () => ({ lean: async () => null }));
  const createSpy = mock.method(SeoOpportunity, "create", async (doc) => doc);

  const rows = [
    { referringDomain: "already-linking.com" }, // already links to us -> skip
    { referringDomain: "also-linking.com" }, // links to us (www stripped) -> skip
    { referringDomain: "gap-domain.com", linkType: "guest post", anchorText: "cloud training" },
  ];

  const summary = await importCompetitorBacklinkCsv({ rows, competitorName: "CompetitorX" });

  assert.equal(summary.skippedOwn, 2);
  assert.equal(summary.gapsFound, 1);
  assert.equal(createSpy.mock.callCount(), 1);
  const created = createSpy.mock.calls[0].arguments[0];
  assert.equal(created.referringDomain, "gap-domain.com");
  assert.equal(created.recordType, "competitor-gap");
  assert.equal(created.discoverySource, "csv-import");
});

test("dedupes on sourceKey across repeated imports", async () => {
  mock.method(SeoMonitoring, "find", () => ({ distinct: async () => [] }));
  mock.method(SeoOpportunity, "findOne", () => ({ lean: async () => ({ _id: "existing" }) }));
  const createSpy = mock.method(SeoOpportunity, "create", async (doc) => doc);

  const rows = [{ referringDomain: "seen-before.com" }];
  const summary = await importCompetitorBacklinkCsv({ rows, competitorName: "CompetitorX" });

  assert.equal(summary.skippedExisting, 1);
  assert.equal(createSpy.mock.callCount(), 0);
});

test("throws on an empty rows array", async () => {
  await assert.rejects(() => importCompetitorBacklinkCsv({ rows: [], competitorName: "X" }));
});

test("throws when competitorName is missing", async () => {
  await assert.rejects(() => importCompetitorBacklinkCsv({ rows: [{ referringDomain: "a.com" }], competitorName: "" }));
});
