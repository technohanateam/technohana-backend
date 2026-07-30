import { test } from "node:test";
import assert from "node:assert/strict";
import { CRAWL_ISSUE_RULES, BACKLINK_RULES } from "../../src/services/recommendationEngine.js";
import { ISSUE } from "../../src/services/seoCrawler.js";

test("every crawl issue rule declares priority, impact, effort, confidence", () => {
  for (const rule of CRAWL_ISSUE_RULES) {
    assert.ok(["critical", "high", "medium", "low"].includes(rule.priority), `${rule.code} priority`);
    assert.ok(["high", "medium", "low"].includes(rule.impact), `${rule.code} impact`);
    assert.ok(["low", "medium", "high"].includes(rule.effort), `${rule.code} effort`);
    assert.ok(["high", "medium", "low"].includes(rule.confidence), `${rule.code} confidence`);
    assert.ok(["technical", "content", "performance", "gsc", "ga4"].includes(rule.category), `${rule.code} category`);
  }
});

test("BROKEN_LINK rule maps to a real crawler issue code", () => {
  const rule = CRAWL_ISSUE_RULES.find((r) => r.code === "BROKEN_LINK");
  assert.ok(rule);
  assert.equal(rule.code, ISSUE.BROKEN_LINK);
});

test("every backlink rule declares priority, impact, effort, confidence, and category 'backlink'", () => {
  for (const rule of BACKLINK_RULES) {
    assert.ok(["critical", "high", "medium", "low"].includes(rule.priority), `${rule.code} priority`);
    assert.ok(["high", "medium", "low"].includes(rule.impact), `${rule.code} impact`);
    assert.ok(["low", "medium", "high"].includes(rule.effort), `${rule.code} effort`);
    assert.ok(["high", "medium", "low"].includes(rule.confidence), `${rule.code} confidence`);
    assert.equal(rule.category, "backlink");
  }
});

test("backlink rules cover all four expected rule codes", () => {
  const codes = BACKLINK_RULES.map((r) => r.code).sort();
  assert.deepEqual(codes, [
    "COMPETITOR_GAP_HIGH_SCORE",
    "HIGH_VALUE_UNCONTACTED_OPPORTUNITY",
    "LOST_LINK_NEEDS_REOUTREACH",
    "STALLED_OUTREACH_NO_FOLLOWUP",
  ]);
});
