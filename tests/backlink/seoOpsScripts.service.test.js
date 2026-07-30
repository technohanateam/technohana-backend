import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOpportunityScore, DEFAULT_SCORING_WEIGHTS } from "../../src/services/seoOpsScripts.service.js";

test("default weights sum to 100", () => {
  const total = Object.values(DEFAULT_SCORING_WEIGHTS).reduce((sum, w) => sum + w, 0);
  assert.equal(total, 100);
});

test("a maximal-quality opportunity scores at or near 100", () => {
  const doc = {
    potentialForTechnohana: "Very High",
    evidenceLevel: "Verified",
    priority: "Very High",
    estimatedAuthority: "100",
    trafficPotential: "Very High",
    opportunityType: "partnership",
    competitionLevel: "Low",
    contentYear: new Date().getFullYear(),
  };
  const { overallScore, authorityUnscored } = computeOpportunityScore(doc, DEFAULT_SCORING_WEIGHTS, new Date().getFullYear());
  assert.equal(authorityUnscored, false);
  assert.ok(overallScore >= 90 && overallScore <= 100, `expected near-100, got ${overallScore}`);
});

test("a minimal/empty opportunity scores at or near 0", () => {
  const doc = {};
  const { overallScore, authorityUnscored } = computeOpportunityScore(doc, DEFAULT_SCORING_WEIGHTS, new Date().getFullYear());
  assert.equal(authorityUnscored, true);
  assert.ok(overallScore >= 0 && overallScore < 30, `expected near-0, got ${overallScore}`);
});

test("score always stays within [0, 100] across a spread of inputs", () => {
  const samples = [
    { potentialForTechnohana: "Medium", priority: "Low", estimatedAuthority: "45", opportunityType: "directory" },
    { potentialForTechnohana: "High", evidenceLevel: "Observed", competitionLevel: "High", contentYear: 2019 },
    { trafficPotential: "Low", opportunityType: "guest post", competitionLevel: "Medium" },
  ];
  for (const doc of samples) {
    const { overallScore } = computeOpportunityScore(doc, DEFAULT_SCORING_WEIGHTS, 2026);
    assert.ok(overallScore >= 0 && overallScore <= 100, `out of range: ${overallScore}`);
  }
});

test("custom admin-configured weights change the outcome", () => {
  const doc = { estimatedAuthority: "100" };
  const lowAuthorityWeight = { ...DEFAULT_SCORING_WEIGHTS, authority: 0 };
  const highAuthorityWeight = { ...DEFAULT_SCORING_WEIGHTS, authority: 100 };

  const lowResult = computeOpportunityScore(doc, lowAuthorityWeight, 2026);
  const highResult = computeOpportunityScore(doc, highAuthorityWeight, 2026);

  assert.ok(highResult.overallScore > lowResult.overallScore);
});

test("unknown estimatedAuthority is flagged unscored, not fabricated", () => {
  const { authorityUnscored } = computeOpportunityScore({ estimatedAuthority: "unknown" }, DEFAULT_SCORING_WEIGHTS, 2026);
  assert.equal(authorityUnscored, true);
});
