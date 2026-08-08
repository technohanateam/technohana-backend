import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCoursePriorityScore, DEFAULT_CAPS } from "../../src/services/contentFactory/coursePriorityScoring.service.js";

// Regression coverage for a live-validation finding (2026-08-08): the
// DEFAULT_CAPS were guessed with no real distribution to calibrate against,
// and against real production data (courseViews90d cap of 5000 vs an actual
// catalogue-wide 90-day total of ~2,300) every course's `views` component
// normalized to near-zero, collapsing the whole score to whatever `recency`
// alone contributed — which is itself near-uniform when almost no course has
// ever had a blog post. The fix: coursePriorityAggregation.service.js now
// derives dynamic caps from the actual observed max per run and passes them
// as the optional third `caps` argument below.

const ZERO_SIGNALS = {
  enquiryCount90d: 0, orderRevenue90d: 0, courseViews90d: 0,
  gscClicks28d: 0, gscImpressions28d: 0, daysSinceLastBlog: null,
};

test("computeCoursePriorityScore is pure — plain object inputs, no imports needed to run it", () => {
  const result = computeCoursePriorityScore({ ...ZERO_SIGNALS, courseViews90d: 20 }, undefined, { courseViews90d: 40 });
  assert.equal(typeof result.score, "number");
  assert.equal(typeof result.tier, "string");
});

test("caps default to DEFAULT_CAPS when omitted (backward compatible with 2-arg callers)", () => {
  const withDefaults = computeCoursePriorityScore({ ...ZERO_SIGNALS, courseViews90d: 100 });
  const withExplicitDefaultCaps = computeCoursePriorityScore({ ...ZERO_SIGNALS, courseViews90d: 100 }, undefined, DEFAULT_CAPS);
  assert.deepEqual(withDefaults, withExplicitDefaultCaps);
});

test("shrinking the courseViews90d cap toward the real observed max restores differentiation", () => {
  // Same raw view count (20), but scored against the old guessed cap (5000)
  // vs a realistic dynamic cap (40, e.g. the actual max observed in a run).
  const underGuessedCap = computeCoursePriorityScore({ ...ZERO_SIGNALS, courseViews90d: 20 }, undefined, { ...DEFAULT_CAPS, courseViews90d: 5000 });
  const underDynamicCap = computeCoursePriorityScore({ ...ZERO_SIGNALS, courseViews90d: 20 }, undefined, { ...DEFAULT_CAPS, courseViews90d: 40 });
  assert.ok(underDynamicCap.score > underGuessedCap.score, "a realistic cap must score real signal higher than an unrealistically high guessed cap");
});

test("a course with zero real signal still scores low even under a tight dynamic cap (no false positives)", () => {
  const result = computeCoursePriorityScore(ZERO_SIGNALS, undefined, { ...DEFAULT_CAPS, courseViews90d: 40, enquiryCount90d: 5 });
  assert.ok(result.score <= 15, "zero real activity should not be scored as high priority merely because the cap shrank");
});

test("caps object is merged with DEFAULT_CAPS, not fully replaced — a partial caps override still normalizes revenue/gsc correctly", () => {
  const partial = computeCoursePriorityScore(
    { ...ZERO_SIGNALS, orderRevenue90d: 250000 },
    undefined,
    { courseViews90d: 40 } // only overriding views, not revenue
  );
  const explicitRevenueCap = computeCoursePriorityScore(
    { ...ZERO_SIGNALS, orderRevenue90d: 250000 },
    undefined,
    { courseViews90d: 40, orderRevenue90d: DEFAULT_CAPS.orderRevenue90d }
  );
  assert.deepEqual(partial, explicitRevenueCap, "omitting a cap key must fall back to DEFAULT_CAPS for that signal, not zero it out");
});
