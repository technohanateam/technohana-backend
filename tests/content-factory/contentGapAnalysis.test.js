import { test } from "node:test";
import assert from "node:assert/strict";
import { matchGapQueryToCourses, buildCourseGapSignalMap, buildSuggestedAngle } from "../../src/services/contentFactory/contentGapAnalysis.service.js";

const CATALOG = [
  { courseSlug: "aws-solutions-architect", courseTitle: "AWS Solutions Architect", category: "Cloud" },
  { courseSlug: "excel-basics", courseTitle: "Excel Basics", category: "Office Productivity" },
];

test("matchGapQueryToCourses is pure and matches relevant queries", () => {
  const matches = matchGapQueryToCourses("aws solutions architect certification cost", CATALOG, 0.1);
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].courseSlug, "aws-solutions-architect");
});

test("matchGapQueryToCourses returns empty for unrelated query", () => {
  const matches = matchGapQueryToCourses("best pizza recipes", CATALOG, 0.25);
  assert.equal(matches.length, 0);
});

test("matchGapQueryToCourses handles empty query without throwing", () => {
  assert.deepEqual(matchGapQueryToCourses("", CATALOG), []);
});

test("buildSuggestedAngle references the query and CTR", () => {
  const angle = buildSuggestedAngle({ query: "aws certification cost", impressions: 500, ctr: 0.01 }, { courseTitle: "AWS Solutions Architect" });
  assert.match(angle, /aws certification cost/);
  assert.match(angle, /1\.0%/);
});

test("buildCourseGapSignalMap picks the highest-scoring gap per course", () => {
  const gaps = [
    { query: "low", impressions: 50, matchedCourses: [{ courseSlug: "aws-solutions-architect", relevanceScore: 0.5 }] },
    { query: "high", impressions: 500, matchedCourses: [{ courseSlug: "aws-solutions-architect", relevanceScore: 0.8 }] },
  ];
  const map = buildCourseGapSignalMap(gaps);
  assert.equal(map["aws-solutions-architect"].query, "high");
  assert.ok(map["aws-solutions-architect"].seoOpportunityScore > 0);
});

test("buildCourseGapSignalMap returns empty object for no gaps", () => {
  assert.deepEqual(buildCourseGapSignalMap([]), {});
});
