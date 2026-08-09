import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPublicBlogFilter, isPubliclyVisible } from "../../src/controllers/blog.controller.js";

// Regression coverage for the AI-Content-Factory approve-and-schedule fix:
// a post with published:true and a future scheduledAt must never be
// publicly visible before that time, across every public retrieval path
// (list, single-post JSON, SSR/OG crawler HTML) — all three now share
// buildPublicBlogFilter/isPubliclyVisible instead of each hand-rolling
// their own published/scheduledAt condition.

const NOW = new Date("2026-08-08T12:00:00Z");
const PAST = new Date("2026-08-01T00:00:00Z");
const FUTURE = new Date("2026-12-25T00:00:00Z");

test("buildPublicBlogFilter requires published:true", () => {
  const filter = buildPublicBlogFilter(NOW);
  assert.equal(filter.published, true);
});

test("buildPublicBlogFilter's $or covers null and past-or-present scheduledAt only", () => {
  const filter = buildPublicBlogFilter(NOW);
  assert.deepEqual(filter.$or, [{ scheduledAt: null }, { scheduledAt: { $lte: NOW } }]);
});

test("isPubliclyVisible: published + no scheduledAt -> visible", () => {
  assert.equal(isPubliclyVisible({ published: true, scheduledAt: null }, NOW), true);
});

test("isPubliclyVisible: published + scheduledAt in the past -> visible", () => {
  assert.equal(isPubliclyVisible({ published: true, scheduledAt: PAST }, NOW), true);
});

test("isPubliclyVisible: published + scheduledAt exactly now -> visible (inclusive boundary)", () => {
  assert.equal(isPubliclyVisible({ published: true, scheduledAt: NOW }, NOW), true);
});

test("isPubliclyVisible: published:true + scheduledAt in the FUTURE -> NOT visible (the bug this guards against)", () => {
  assert.equal(isPubliclyVisible({ published: true, scheduledAt: FUTURE }, NOW), false);
});

test("isPubliclyVisible: published:false -> never visible, regardless of scheduledAt", () => {
  assert.equal(isPubliclyVisible({ published: false, scheduledAt: null }, NOW), false);
  assert.equal(isPubliclyVisible({ published: false, scheduledAt: PAST }, NOW), false);
  assert.equal(isPubliclyVisible({ published: false, scheduledAt: FUTURE }, NOW), false);
});

test("isPubliclyVisible: missing/undefined blog -> not visible", () => {
  assert.equal(isPubliclyVisible(null, NOW), false);
  assert.equal(isPubliclyVisible(undefined, NOW), false);
});

// getAllBlogs, getBlogBySlug, and getBlog (the SSR/OG route) must all be
// built from the exact same filter — this is a static-source guard so a
// future edit can't silently drop the scheduledAt clause from one of the
// three routes again (that was the exact shape of the original bug: two
// routes had the $or clause, getBlog did not).
test("getAllBlogs, getBlogBySlug, and getBlog source all reference buildPublicBlogFilter", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = fileURLToPath(new URL("../../src/controllers/blog.controller.js", import.meta.url));
  const src = readFileSync(path, "utf8");

  const getAllBlogsFn = src.slice(src.indexOf("export const getAllBlogs"), src.indexOf("export const getBlogBySlug"));
  const getBlogBySlugFn = src.slice(src.indexOf("export const getBlogBySlug"), src.indexOf("export const getBlog ="));
  const getBlogFn = src.slice(src.indexOf("export const getBlog ="));

  assert.ok(getAllBlogsFn.includes("buildPublicBlogFilter("), "getAllBlogs must use buildPublicBlogFilter");
  assert.ok(getBlogBySlugFn.includes("buildPublicBlogFilter("), "getBlogBySlug must use buildPublicBlogFilter");
  assert.ok(getBlogFn.includes("buildPublicBlogFilter("), "getBlog (SSR/OG route) must use buildPublicBlogFilter");
});
