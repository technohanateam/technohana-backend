import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBlogFreshness, worstStatus } from "../../src/services/contentFactory/contentFreshness.service.js";

const NOW = new Date("2026-08-08T00:00:00Z");
const KEYWORDS = ["AI", "GPT", "AWS"];

test("classifyBlogFreshness marks a recently reviewed non-sensitive post FRESH", () => {
  const blog = { updatedAt: new Date("2026-07-01T00:00:00Z"), category: "Office Productivity", tags: [] };
  const { status } = classifyBlogFreshness(blog, KEYWORDS, NOW);
  assert.equal(status, "FRESH");
});

test("classifyBlogFreshness marks an old non-sensitive post OUTDATED past 180 days", () => {
  const blog = { updatedAt: new Date("2025-12-01T00:00:00Z"), category: "Office Productivity", tags: [] };
  const { status } = classifyBlogFreshness(blog, KEYWORDS, NOW);
  assert.equal(status, "OUTDATED");
});

test("classifyBlogFreshness ages sensitive (keyword-matched) content faster than standard content", () => {
  const ageInDays = 60;
  const date = new Date(NOW.getTime() - ageInDays * 24 * 60 * 60 * 1000);
  const sensitiveBlog = { updatedAt: date, category: "AI/GenAI", tags: ["GPT"] };
  const standardBlog = { updatedAt: date, category: "Office Productivity", tags: [] };
  const sensitiveResult = classifyBlogFreshness(sensitiveBlog, KEYWORDS, NOW);
  const standardResult = classifyBlogFreshness(standardBlog, KEYWORDS, NOW);
  assert.equal(sensitiveResult.isSensitive, true);
  assert.equal(standardResult.isSensitive, false);
  assert.equal(sensitiveResult.status, "REVIEW_RECOMMENDED"); // 60 days > 45-day sensitive fresh threshold, <= 120-day review threshold
  assert.notEqual(sensitiveResult.status, "FRESH");
  assert.equal(standardResult.status, "FRESH"); // 60 days well within 90-day standard fresh threshold
});

test("classifyBlogFreshness prefers lastReviewedAt over updatedAt when present", () => {
  const blog = {
    updatedAt: new Date("2025-01-01T00:00:00Z"), // very old
    lastReviewedAt: new Date("2026-08-01T00:00:00Z"), // recent
    category: "Office Productivity",
    tags: [],
  };
  const { status } = classifyBlogFreshness(blog, KEYWORDS, NOW);
  assert.equal(status, "FRESH");
});

test("worstStatus returns OUTDATED when any status is OUTDATED", () => {
  assert.equal(worstStatus(["FRESH", "REVIEW_RECOMMENDED", "OUTDATED"]), "OUTDATED");
});

test("worstStatus returns FRESH when all statuses are FRESH", () => {
  assert.equal(worstStatus(["FRESH", "FRESH"]), "FRESH");
});

test("worstStatus returns null for empty input", () => {
  assert.equal(worstStatus([]), null);
});
