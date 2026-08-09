import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreDuplicateRisk } from "../../src/services/contentFactory/duplicateDetection.service.js";
import { computeCoursePriorityScore } from "../../src/services/contentFactory/coursePriorityScoring.service.js";
import { isDueForContent, computeOverallScore } from "../../src/services/contentFactory/contentStrategy.service.js";

// Production-validation-audit additions: these three pure functions had zero
// unit test coverage despite being explicitly documented as pure/no-DB/
// no-network and "trivially unit-testable" — closing that gap per the
// audit's "add tests for easy pure-function gaps" instruction. No DB/network
// connection is required to run any test in this file.

// ── duplicateDetection.service.js — scoreDuplicateRisk() ──────────────────

test("scoreDuplicateRisk: empty corpus is always NONE risk with no signals", () => {
  const result = scoreDuplicateRisk({ title: "Intro to AWS", slug: "intro-to-aws" }, []);
  assert.equal(result.duplicateScore, 0);
  assert.equal(result.cannibalizationRisk, "NONE");
  assert.deepEqual(result.signals, []);
});

test("scoreDuplicateRisk: identical slug is an EXACT_DUPLICATE with score 100 / HIGH risk", () => {
  const result = scoreDuplicateRisk(
    { title: "A Totally Different Title", slug: "intro-to-aws", focusKeyword: "aws basics" },
    [{ title: "Intro to AWS", slug: "intro-to-aws", focusKeyword: "aws fundamentals", source: "blog", id: "b1" }]
  );
  assert.equal(result.duplicateScore, 100);
  assert.equal(result.cannibalizationRisk, "HIGH");
  assert.ok(result.signals.some((s) => s.type === "EXACT_DUPLICATE" && s.matchedAgainstType === "BLOG" && s.matchedAgainstId === "b1"));
});

test("scoreDuplicateRisk: identical focus keyword (different slug) is also EXACT_DUPLICATE", () => {
  const result = scoreDuplicateRisk(
    { title: "Different Title Entirely", slug: "different-slug", focusKeyword: "kubernetes certification" },
    [{ title: "Some Other Title", slug: "some-other-slug", focusKeyword: "kubernetes certification", source: "opportunity", id: "o1" }]
  );
  assert.equal(result.duplicateScore, 100);
  assert.equal(result.cannibalizationRisk, "HIGH");
});

test("scoreDuplicateRisk: near-identical titles trigger TITLE_SIMILARITY at/above the default 0.75 threshold", () => {
  const result = scoreDuplicateRisk(
    { title: "Best AWS Certification Guide 2026", slug: "aws-cert-guide-2026" },
    [{ title: "Best AWS Certification Guide", slug: "aws-cert-guide", source: "blog", id: "b2" }]
  );
  assert.ok(result.duplicateScore > 0);
  assert.ok(result.signals.some((s) => s.type === "TITLE_SIMILARITY"));
  assert.notEqual(result.cannibalizationRisk, "NONE");
});

test("scoreDuplicateRisk: completely unrelated content scores 0 / NONE", () => {
  const result = scoreDuplicateRisk(
    { title: "Deep Dive Into Generative AI Agents", slug: "genai-agents-deep-dive", focusKeyword: "generative ai agents" },
    [{ title: "Project Management Fundamentals", slug: "pm-fundamentals", focusKeyword: "project management basics", source: "blog", id: "b3" }]
  );
  assert.equal(result.duplicateScore, 0);
  assert.equal(result.cannibalizationRisk, "NONE");
  assert.deepEqual(result.signals, []);
});

test("scoreDuplicateRisk: SEARCH_INTENT_OVERLAP fires on shared clusterId + searchIntent even with different titles", () => {
  const result = scoreDuplicateRisk(
    { title: "How Cloud Certifications Boost Your Career", slug: "cloud-cert-career", clusterId: "cluster-1", searchIntent: "informational" },
    [
      {
        title: "Why Every Engineer Needs a Cloud Certification",
        slug: "engineer-cloud-cert",
        clusterId: "cluster-1",
        searchIntent: "informational",
        source: "opportunity",
        id: "o2",
      },
    ]
  );
  assert.ok(result.signals.some((s) => s.type === "SEARCH_INTENT_OVERLAP" && s.score === 40));
});

test("scoreDuplicateRisk: custom thresholds are honored instead of the defaults", () => {
  const candidate = { title: "Data Science Bootcamp Review", slug: "ds-bootcamp-review" };
  const corpus = [{ title: "Data Science Course Overview", slug: "ds-course-overview", source: "blog", id: "b4" }];
  const permissive = scoreDuplicateRisk(candidate, corpus, { titleSimilarity: 0.1 });
  const strict = scoreDuplicateRisk(candidate, corpus, { titleSimilarity: 0.99 });
  assert.ok(permissive.signals.some((s) => s.type === "TITLE_SIMILARITY"));
  assert.ok(!strict.signals.some((s) => s.type === "TITLE_SIMILARITY"));
});

test("scoreDuplicateRisk: deterministic — identical inputs produce identical output", () => {
  const candidate = { title: "Kubernetes for Beginners", slug: "k8s-beginners", focusKeyword: "kubernetes basics" };
  const corpus = [{ title: "Kubernetes 101", slug: "k8s-101", focusKeyword: "kubernetes intro", source: "blog", id: "b5" }];
  const r1 = scoreDuplicateRisk(candidate, corpus);
  const r2 = scoreDuplicateRisk(candidate, corpus);
  assert.deepEqual(r1, r2);
});

// ── coursePriorityScoring.service.js — computeCoursePriorityScore() ───────

test("computeCoursePriorityScore: all-zero signals with a never-blogged course still returns a bounded score/tier", () => {
  const result = computeCoursePriorityScore({});
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(["TIER_1_STRATEGIC", "TIER_2_GROWTH", "TIER_3_EVERGREEN", "TIER_4_LONG_TAIL"].includes(result.tier));
});

test("computeCoursePriorityScore: maxed-out signals score at or near 100 and land TIER_1_STRATEGIC", () => {
  const result = computeCoursePriorityScore({
    enquiryCount90d: 1000,
    orderRevenue90d: 5000000,
    courseViews90d: 50000,
    gscClicks28d: 5000,
    gscImpressions28d: 200000,
    daysSinceLastBlog: 180,
  });
  assert.equal(result.score, 100);
  assert.equal(result.tier, "TIER_1_STRATEGIC");
});

test("computeCoursePriorityScore: higher signals never score lower than weaker signals (monotonic)", () => {
  const weak = computeCoursePriorityScore({ enquiryCount90d: 2, orderRevenue90d: 1000, courseViews90d: 50 });
  const strong = computeCoursePriorityScore({ enquiryCount90d: 30, orderRevenue90d: 400000, courseViews90d: 4000 });
  assert.ok(strong.score > weak.score);
});

test("computeCoursePriorityScore: never-blogged (null daysSinceLastBlog) scores at least as high as recently-blogged, all else equal", () => {
  const recent = computeCoursePriorityScore({ enquiryCount90d: 10, daysSinceLastBlog: 1 });
  const neverBlogged = computeCoursePriorityScore({ enquiryCount90d: 10, daysSinceLastBlog: null });
  assert.ok(neverBlogged.score >= recent.score);
});

test("computeCoursePriorityScore: custom weights change the outcome versus defaults", () => {
  const inputs = { enquiryCount90d: 40, orderRevenue90d: 0, courseViews90d: 0, gscClicks28d: 0, gscImpressions28d: 0 };
  const defaultWeighted = computeCoursePriorityScore(inputs);
  const revenueOnly = computeCoursePriorityScore(inputs, { enquiry: 0, revenue: 100, views: 0, gscClicks: 0, gscImpressions: 0, recency: 0 });
  assert.ok(defaultWeighted.score > revenueOnly.score);
});

test("computeCoursePriorityScore: deterministic and never throws on garbage input", () => {
  const inputs = { enquiryCount90d: -5, orderRevenue90d: NaN, courseViews90d: undefined };
  assert.doesNotThrow(() => computeCoursePriorityScore(inputs));
  const r1 = computeCoursePriorityScore(inputs);
  const r2 = computeCoursePriorityScore(inputs);
  assert.deepEqual(r1, r2);
});

// ── contentStrategy.service.js — isDueForContent() / computeOverallScore() ─

test("isDueForContent: disabled course settings are never due", () => {
  assert.equal(isDueForContent({ enabled: false, frequency: "DAILY" }), false);
});

test("isDueForContent: never-generated course (no lastBlogGeneratedAt) is always due", () => {
  assert.equal(isDueForContent({ enabled: true, frequency: "MONTHLY" }), true);
});

test("isDueForContent: ON_DEMAND frequency is never auto-due even with a stale lastBlogGeneratedAt", () => {
  const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  assert.equal(isDueForContent({ enabled: true, frequency: "ON_DEMAND", lastBlogGeneratedAt: longAgo }), false);
});

test("isDueForContent: WEEKLY frequency is due after 8 days but not after 2 days", () => {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  assert.equal(isDueForContent({ enabled: true, frequency: "WEEKLY", lastBlogGeneratedAt: eightDaysAgo }), true);
  assert.equal(isDueForContent({ enabled: true, frequency: "WEEKLY", lastBlogGeneratedAt: twoDaysAgo }), false);
});

test("isDueForContent: frequencyOverride takes precedence over frequency", () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  // frequency says MONTHLY (not due after 2 days) but override says DAILY (due after 2 days)
  assert.equal(
    isDueForContent({ enabled: true, frequency: "MONTHLY", frequencyOverride: "DAILY", lastBlogGeneratedAt: twoDaysAgo }),
    true
  );
});

test("isDueForContent: null/undefined settings is never due", () => {
  assert.equal(isDueForContent(null), false);
  assert.equal(isDueForContent(undefined), false);
});

test("computeOverallScore: all-zero inputs score 0", () => {
  assert.equal(computeOverallScore({}), 0);
});

test("computeOverallScore: maxed-out positive signals with zero duplicate risk score 100", () => {
  const score = computeOverallScore({
    courseRelevanceScore: 100,
    businessIntentScore: 100,
    seoOpportunityScore: 100,
    coursePriorityScore: 100,
    trendScore: 100,
    duplicateScore: 0,
  });
  assert.equal(score, 100);
});

test("computeOverallScore: a HIGH duplicateScore (100) drives the final score to 0 regardless of other signals", () => {
  const score = computeOverallScore({
    courseRelevanceScore: 100,
    businessIntentScore: 100,
    seoOpportunityScore: 100,
    coursePriorityScore: 100,
    trendScore: 100,
    duplicateScore: 100,
  });
  assert.equal(score, 0);
});

test("computeOverallScore: partial duplicateScore proportionally penalizes rather than zeroing/ignoring it", () => {
  const clean = computeOverallScore({ courseRelevanceScore: 80, businessIntentScore: 80, coursePriorityScore: 80, duplicateScore: 0 });
  const halfRisky = computeOverallScore({ courseRelevanceScore: 80, businessIntentScore: 80, coursePriorityScore: 80, duplicateScore: 50 });
  assert.ok(halfRisky < clean);
  assert.ok(halfRisky > 0);
});

test("computeOverallScore: result is always clamped to the 0-100 range even with out-of-range inputs", () => {
  const score = computeOverallScore({ courseRelevanceScore: 500, businessIntentScore: 500, coursePriorityScore: 500, duplicateScore: -50 });
  assert.ok(score >= 0 && score <= 100);
});
