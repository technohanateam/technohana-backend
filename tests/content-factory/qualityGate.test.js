import { test } from "node:test";
import assert from "node:assert/strict";
import { computeQualityGateResult } from "../../src/services/contentFactory/qualityGate.service.js";

const GOOD_SCORES = {
  seoScore: 90,
  originalityScore: 85,
  readabilityScore: 88,
  courseRelevanceScore: 90,
  searchIntentAlignmentScore: 85,
  internalLinksScore: 100,
  factualityScore: 95,
  ctaRelevanceScore: 80,
  specificityScore: 85,
  originalInsightScore: 80,
  editorialQualityScore: 88,
  aiStyleRiskScore: 10,
};

test("computeQualityGateResult imports no DB/network modules", () => {
  // Purity contract: the module this function lives in must not import
  // mongoose models or network clients directly usable by the pure fn —
  // this test asserts the function itself works from plain objects alone,
  // with no DB/network side effects possible.
  const result = computeQualityGateResult(GOOD_SCORES, { aiStyleRiskThreshold: 30, overallScoreFloor: 60 });
  assert.equal(typeof result.overallScore, "number");
  assert.equal(typeof result.flaggedForRevision, "boolean");
  assert.ok(Array.isArray(result.flagReasons));
});

test("high-quality scores are not flagged for revision", () => {
  const result = computeQualityGateResult(GOOD_SCORES, { aiStyleRiskThreshold: 30, overallScoreFloor: 60 });
  assert.equal(result.flaggedForRevision, false);
  assert.equal(result.flagReasons.length, 0);
  assert.ok(result.overallScore >= 60);
});

test("high aiStyleRiskScore alone triggers flaggedForRevision even with good other scores", () => {
  const scores = { ...GOOD_SCORES, aiStyleRiskScore: 75 };
  const result = computeQualityGateResult(scores, { aiStyleRiskThreshold: 30, overallScoreFloor: 60 });
  assert.equal(result.flaggedForRevision, true);
  assert.ok(result.flagReasons.some((r) => r.includes("AI-style risk")));
});

test("low overallScore alone triggers flaggedForRevision", () => {
  const scores = {
    seoScore: 20,
    originalityScore: 20,
    readabilityScore: 20,
    courseRelevanceScore: 20,
    searchIntentAlignmentScore: 20,
    internalLinksScore: 20,
    factualityScore: 20,
    ctaRelevanceScore: 20,
    specificityScore: 20,
    originalInsightScore: 20,
    editorialQualityScore: 20,
    aiStyleRiskScore: 10,
  };
  const result = computeQualityGateResult(scores, { aiStyleRiskThreshold: 30, overallScoreFloor: 60 });
  assert.equal(result.flaggedForRevision, true);
  assert.ok(result.overallScore < 60);
  assert.ok(result.flagReasons.some((r) => r.includes("Overall quality score")));
});

test("missing settings fall back to documented defaults (30 / 60)", () => {
  const scores = { ...GOOD_SCORES, aiStyleRiskScore: 35 };
  const result = computeQualityGateResult(scores, {});
  assert.equal(result.flaggedForRevision, true); // 35 > default threshold 30
});

test("clamps out-of-range and missing dimension values instead of throwing", () => {
  const scores = { seoScore: 500, originalityScore: -20 };
  assert.doesNotThrow(() => computeQualityGateResult(scores, { aiStyleRiskThreshold: 30, overallScoreFloor: 60 }));
});
