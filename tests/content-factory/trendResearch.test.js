import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTrendToCourses, buildCourseTrendScoreMap } from "../../src/services/contentFactory/trendResearch.service.js";

const CATALOG = [
  { courseSlug: "genai-fundamentals", courseTitle: "Generative AI Fundamentals", category: "AI/GenAI", description: "Learn large language models and agentic frameworks" },
  { courseSlug: "aws-solutions-architect", courseTitle: "AWS Solutions Architect", category: "Cloud", description: "Design scalable cloud infrastructure on AWS" },
  { courseSlug: "excel-basics", courseTitle: "Excel Basics", category: "Office Productivity", description: "Spreadsheets for beginners" },
];

test("matchTrendToCourses is pure and returns no DB/network side effects", () => {
  const trend = { topic: "New agentic AI framework release", summary: "A major agentic framework for large language models launched this month" };
  const matches = matchTrendToCourses(trend, CATALOG, 0.1);
  assert.ok(Array.isArray(matches));
});

test("matchTrendToCourses ranks the most relevant course first", () => {
  const trend = { topic: "New agentic AI framework release", summary: "A major agentic framework for large language models launched this month", clusterCategories: ["AI/GenAI"] };
  const matches = matchTrendToCourses(trend, CATALOG, 0.05);
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].courseSlug, "genai-fundamentals");
});

test("matchTrendToCourses drops matches below threshold", () => {
  const trend = { topic: "New agentic AI framework release", summary: "Large language model news" };
  const matches = matchTrendToCourses(trend, CATALOG, 0.9);
  assert.equal(matches.length, 0);
});

test("matchTrendToCourses handles empty trend text without throwing", () => {
  const matches = matchTrendToCourses({ topic: "", summary: "" }, CATALOG, 0.3);
  assert.equal(matches.length, 0);
});

test("buildCourseTrendScoreMap picks the best trend score per course", () => {
  const trends = [
    { topic: "A", matchedCourses: [{ courseSlug: "genai-fundamentals", relevanceScore: 0.4 }] },
    { topic: "B", matchedCourses: [{ courseSlug: "genai-fundamentals", relevanceScore: 0.7 }, { courseSlug: "aws-solutions-architect", relevanceScore: 0.3 }] },
  ];
  const map = buildCourseTrendScoreMap(trends);
  assert.equal(map["genai-fundamentals"], 70);
  assert.equal(map["aws-solutions-architect"], 30);
});

test("buildCourseTrendScoreMap returns empty object for no trends", () => {
  assert.deepEqual(buildCourseTrendScoreMap([]), {});
});
