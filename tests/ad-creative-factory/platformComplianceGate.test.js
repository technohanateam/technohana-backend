import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPlatformFit,
  scanComplianceBlocklist,
  computeAdComplianceGateResult,
} from "../../src/services/adCreativeFactory/platformComplianceGate.service.js";

const SETTINGS = {
  platformLengthLimits: {
    meta: { headline: 40, primaryText: 125, description: 30 },
    linkedin: { headline: 70, primaryText: 150, description: 100 },
  },
  complianceKeywordBlocklist: ["guaranteed job", "100% placement"],
  brandVoiceRiskThreshold: 30,
};

test("applyPlatformFit marks a variant within the limit as withinLimit with correct charCount", () => {
  const draft = { headlines: [{ text: "Learn AWS Fast", platform: "META" }], primaryTexts: [], descriptions: [], ctas: [] };
  const { creativeDraft, oversized } = applyPlatformFit(draft, SETTINGS);
  assert.equal(creativeDraft.headlines[0].charCount, "Learn AWS Fast".length);
  assert.equal(creativeDraft.headlines[0].withinLimit, true);
  assert.equal(oversized.length, 0);
});

test("applyPlatformFit flags an oversized variant and reports it in oversized[]", () => {
  const longHeadline = "A".repeat(50); // exceeds META's 40-char headline limit
  const draft = { headlines: [{ text: longHeadline, platform: "META" }], primaryTexts: [], descriptions: [], ctas: [] };
  const { creativeDraft, oversized } = applyPlatformFit(draft, SETTINGS);
  assert.equal(creativeDraft.headlines[0].withinLimit, false);
  assert.equal(oversized.length, 1);
  assert.equal(oversized[0].field, "headlines");
});

test("applyPlatformFit never throws when a limit isn't configured for a platform", () => {
  const draft = { headlines: [{ text: "Anything", platform: "UNKNOWN" }], primaryTexts: [], descriptions: [], ctas: [] };
  assert.doesNotThrow(() => applyPlatformFit(draft, SETTINGS));
  const { creativeDraft } = applyPlatformFit(draft, SETTINGS);
  assert.equal(creativeDraft.headlines[0].withinLimit, true);
});

test("scanComplianceBlocklist returns [] for clean copy", () => {
  const draft = {
    headlines: [{ text: "Master Cloud Skills", platform: "META" }],
    primaryTexts: [{ text: "Build real-world projects with expert mentors.", platform: "META" }],
    descriptions: [],
    ctas: [],
  };
  assert.deepEqual(scanComplianceBlocklist(draft, SETTINGS), []);
});

test("scanComplianceBlocklist catches a blocklisted phrase case-insensitively, in any field", () => {
  const draft = {
    headlines: [{ text: "Land your dream role", platform: "META" }],
    primaryTexts: [{ text: "We offer GUARANTEED JOB placement after this course.", platform: "META" }],
    descriptions: [],
    ctas: [{ text: "Enroll now", platform: "META" }],
  };
  const hits = scanComplianceBlocklist(draft, SETTINGS);
  assert.deepEqual(hits, ["guaranteed job"]);
});

test("computeAdComplianceGateResult: clean input is never flagged", () => {
  const result = computeAdComplianceGateResult({ blocklistHits: [], oversized: [], brandVoiceResult: null }, SETTINGS);
  assert.equal(result.flaggedForRevision, false);
  assert.equal(result.overallScore, 100);
  assert.equal(result.flagReasons.length, 0);
});

test("computeAdComplianceGateResult: a blocklist hit alone flags with a reason naming the phrase", () => {
  const result = computeAdComplianceGateResult({ blocklistHits: ["guaranteed job"], oversized: [], brandVoiceResult: null }, SETTINGS);
  assert.equal(result.flaggedForRevision, true);
  assert.ok(result.flagReasons.some((r) => r.includes("guaranteed job")));
});

test("computeAdComplianceGateResult: oversized variants alone flag", () => {
  const result = computeAdComplianceGateResult({ blocklistHits: [], oversized: [{ field: "headlines" }], brandVoiceResult: null }, SETTINGS);
  assert.equal(result.flaggedForRevision, true);
});

test("computeAdComplianceGateResult: brandVoiceResult over the threshold flags", () => {
  const result = computeAdComplianceGateResult(
    { blocklistHits: [], oversized: [], brandVoiceResult: { brandVoiceRiskScore: 75, flagReasons: [] } },
    SETTINGS
  );
  assert.equal(result.flaggedForRevision, true);
  assert.ok(result.flagReasons.some((r) => r.includes("Brand-voice risk score")));
});

test("computeAdComplianceGateResult: brandVoiceResult null (skipped) never flags on brand voice", () => {
  const result = computeAdComplianceGateResult({ blocklistHits: [], oversized: [], brandVoiceResult: null }, SETTINGS);
  assert.equal(result.flaggedForRevision, false);
});
