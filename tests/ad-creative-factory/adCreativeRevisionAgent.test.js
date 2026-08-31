import { test } from "node:test";
import assert from "node:assert/strict";
import { diceSimilarity, parseRevisionResponse } from "../../src/services/adCreativeFactory/adCreativeRevisionAgent.service.js";

test("diceSimilarity: identical text is 1", () => {
  assert.equal(diceSimilarity("learn aws fast", "learn aws fast"), 1);
});

test("diceSimilarity: substantially different text is well below the too-similar threshold", () => {
  const score = diceSimilarity(
    "master cloud computing with hands on labs and expert mentors",
    "xyz totally unrelated content about cooking recipes and travel tips"
  );
  // Well below SIMILARITY_FAIL_THRESHOLD (0.9) — proves a genuine rewrite is
  // never mistaken for a synonym-swap, without over-fitting to one exact score.
  assert.ok(score < 0.5, `expected similarity well below the 0.9 too-similar threshold, got ${score}`);
});

const ORIGINAL_DRAFT = {
  headlines: [{ text: "Master AWS in 8 Weeks", platform: "META" }],
  primaryTexts: [{ text: "Build real-world cloud projects with expert mentors and hands-on labs.", platform: "META" }],
  descriptions: [{ text: "Enroll today and start learning.", platform: "META" }],
  ctas: [],
};

test("parseRevisionResponse: a synonym-swap rewrite is judged tooSimilar", () => {
  const nearIdentical = JSON.stringify({
    headlines: [{ text: "Master AWS in 8 Weeks", platform: "META" }],
    primaryTexts: [{ text: "Build real-world cloud projects with expert mentors and hands-on labs.", platform: "META" }],
    descriptions: [{ text: "Enroll today and start learning.", platform: "META" }],
    ctas: [],
  });
  const { tooSimilar, similarity } = parseRevisionResponse(nearIdentical, ORIGINAL_DRAFT, "META");
  assert.equal(tooSimilar, true, `expected tooSimilar, similarity was ${similarity}`);
});

test("parseRevisionResponse: a genuinely different rewrite is not tooSimilar", () => {
  const genuinelyDifferent = JSON.stringify({
    headlines: [{ text: "Land a Cloud Engineering Role", platform: "META" }],
    primaryTexts: [{ text: "Small cohorts, live mentorship, and a portfolio you can show employers.", platform: "META" }],
    descriptions: [{ text: "Seats are limited for the next batch.", platform: "META" }],
    ctas: [],
  });
  const { tooSimilar } = parseRevisionResponse(genuinelyDifferent, ORIGINAL_DRAFT, "META");
  assert.equal(tooSimilar, false);
});

test("parseRevisionResponse: a variant missing platform falls back to fallbackPlatform", () => {
  const missingPlatform = JSON.stringify({
    headlines: [{ text: "New Headline No Platform Field" }],
    primaryTexts: [],
    descriptions: [],
    ctas: [],
  });
  const { revised } = parseRevisionResponse(missingPlatform, ORIGINAL_DRAFT, "LINKEDIN");
  assert.equal(revised.headlines[0].platform, "LINKEDIN");
});
