import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBlogListParams,
  composePublicBlogQuery,
  buildPaginationMeta,
  mapCategoryFacets,
} from "../../src/controllers/blog.controller.js";

// Phase 5C-backend: GET /blogs gained an OPT-IN paginated/filtered/faceted
// envelope. These are DB-less unit tests over the pure helpers that back it;
// they lock in the backward-compatibility contract and the query semantics
// without needing a live MongoDB.

// ── parseBlogListParams: opt-in detection + safe bounds ─────────────────────
test("no params at all -> not paginated (bare-array contract preserved)", () => {
  assert.equal(parseBlogListParams({}).paginated, false);
});

test("page or limit opts into pagination", () => {
  assert.equal(parseBlogListParams({ page: "2" }).paginated, true);
  assert.equal(parseBlogListParams({ limit: "10" }).paginated, true);
});

test("category, tag, or search ALONE also opts into pagination — a filter must never be silently dropped", () => {
  assert.equal(parseBlogListParams({ category: "AI" }).paginated, true);
  assert.equal(parseBlogListParams({ tag: "azure" }).paginated, true);
  assert.equal(parseBlogListParams({ search: "cloud" }).paginated, true);
  assert.equal(parseBlogListParams({ category: "AI", tag: "x", search: "y" }).paginated, true);
});

test("blank/whitespace-only category, tag, or search does NOT opt in on its own", () => {
  assert.equal(parseBlogListParams({ category: "" }).paginated, false);
  assert.equal(parseBlogListParams({ tag: "   " }).paginated, false);
  assert.equal(parseBlogListParams({ search: "" }).paginated, false);
});

test("page/limit defaults when paginated without explicit values", () => {
  const p = parseBlogListParams({ page: "" });
  assert.equal(p.page, 1);
  assert.equal(p.limit, 6);
});

test("page/limit are parsed and bounded safely", () => {
  assert.equal(parseBlogListParams({ page: "3", limit: "12" }).limit, 12);
  // limit capped at 50, floored at 1; page floored at 1; junk -> defaults
  assert.equal(parseBlogListParams({ limit: "9999" }).limit, 50);
  // limit "0" is falsy -> treated as unset, falls back to the safe default (never 0)
  assert.equal(parseBlogListParams({ limit: "0" }).limit, 6);
  assert.equal(parseBlogListParams({ limit: "-5" }).limit, 1);
  assert.equal(parseBlogListParams({ page: "0" }).page, 1);
  assert.equal(parseBlogListParams({ page: "-2" }).page, 1);
  assert.equal(parseBlogListParams({ page: "abc", limit: "abc" }).page, 1);
  assert.equal(parseBlogListParams({ page: "abc", limit: "abc" }).limit, 6);
});

test("category/tag/search are trimmed and normalized to null when blank", () => {
  const p = parseBlogListParams({ page: "1", category: "  AI  ", tag: " azure ", search: "  " });
  assert.equal(p.category, "AI");
  assert.equal(p.tag, "azure");
  assert.equal(p.search, null);
});

// ── composePublicBlogQuery: visibility filter always applied ────────────────
const NOW = new Date("2026-08-08T12:00:00Z");

test("public visibility filter is always present, even with no list filters", () => {
  const q = composePublicBlogQuery({}, NOW);
  assert.equal(q.published, true);
  assert.deepEqual(q.$or, [{ scheduledAt: null }, { scheduledAt: { $lte: NOW } }]);
});

test("category is an exact-match clause; tag matches the tags array", () => {
  const q = composePublicBlogQuery({ category: "AI", tag: "azure" }, NOW);
  assert.equal(q.category, "AI");
  assert.equal(q.tags, "azure");
  assert.equal(q.published, true);
});

test("search builds a case-insensitive $or over title/category/author without clobbering the visibility $or", () => {
  const q = composePublicBlogQuery({ search: "cloud" }, NOW);
  // Visibility $or is moved under $and; top-level $or removed to avoid collision.
  assert.equal(q.$or, undefined);
  assert.ok(Array.isArray(q.$and));
  assert.deepEqual(q.$and[0], { $or: [{ scheduledAt: null }, { scheduledAt: { $lte: NOW } }] });
  const searchClause = q.$and[1].$or;
  assert.equal(searchClause.length, 3);
  for (const clause of searchClause) {
    const [field] = Object.keys(clause);
    assert.ok(["title", "category", "author"].includes(field));
    assert.ok(clause[field] instanceof RegExp);
    assert.equal(clause[field].flags, "i");
  }
});

test("search special characters are escaped (treated literally)", () => {
  const q = composePublicBlogQuery({ search: "a.b*c" }, NOW);
  const rx = q.$and[1].$or[0].title;
  assert.ok(rx.source.includes("a\\.b\\*c"));
});

// ── buildPaginationMeta: math ───────────────────────────────────────────────
test("pagination math computes totalPages via ceil, min 1", () => {
  assert.deepEqual(buildPaginationMeta(42, 1, 6), { page: 1, limit: 6, total: 42, totalPages: 7 });
  assert.deepEqual(buildPaginationMeta(12, 2, 6), { page: 2, limit: 6, total: 12, totalPages: 2 });
  assert.deepEqual(buildPaginationMeta(0, 1, 6), { page: 1, limit: 6, total: 0, totalPages: 1 });
  assert.equal(buildPaginationMeta(7, 1, 6).totalPages, 2);
});

// ── mapCategoryFacets: shape + ordering ─────────────────────────────────────
test("facets drop null categories, map to {name,count}, sort by count desc then name", () => {
  const rows = [
    { _id: "Cloud", count: 3 },
    { _id: null, count: 9 },
    { _id: "AI", count: 5 },
    { _id: "DevOps", count: 5 },
  ];
  assert.deepEqual(mapCategoryFacets(rows), [
    { name: "AI", count: 5 },
    { name: "DevOps", count: 5 },
    { name: "Cloud", count: 3 },
  ]);
  assert.deepEqual(mapCategoryFacets(), []);
});
