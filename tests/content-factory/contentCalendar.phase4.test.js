import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// Resolve absolute paths for mock.module — must match the specifiers
// contentCalendar.service.js's ESM loader actually resolves to.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../../src/services/contentFactory");

const makeOpportunity = (overrides = {}) => ({
  _id: "opp123",
  status: "APPROVED",
  resultingBlogId: "blog123",
  save: mock.fn(async function () { return this; }),
  ...overrides,
});

const makeBlog = (overrides = {}) => ({
  _id: "blog123",
  published: false,
  scheduledAt: null,
  save: mock.fn(async function () { return this; }),
  ...overrides,
});

let opportunityDoc;
let blogFindByIdResult;

mock.module(resolve(SRC, "../../models/contentOpportunity.model.js"), {
  defaultExport: { findById: async () => opportunityDoc },
});

mock.module(resolve(SRC, "../../models/blogs.model.js"), {
  namedExports: { Blogs: { findById: async () => blogFindByIdResult } },
});

const { scheduleOpportunity, unscheduleOpportunity } = await import(
  "../../src/services/contentFactory/contentCalendar.service.js"
);

// ── scheduleOpportunity with a valid resultingBlogId ────────────────────

test("scheduleOpportunity: valid resultingBlogId updates Blog and opportunity.status", async () => {
  opportunityDoc = makeOpportunity();
  blogFindByIdResult = makeBlog();

  const result = await scheduleOpportunity("opp123", "2026-01-01T00:00:00.000Z");

  assert.equal(result.blog.published, true);
  assert.ok(result.blog.scheduledAt instanceof Date);
  assert.equal(result.opportunity.status, "SCHEDULED");
  assert.equal(opportunityDoc.save.mock.callCount(), 1);
  assert.equal(blogFindByIdResult.save.mock.callCount(), 1);
});

// ── scheduleOpportunity with a deleted/nonexistent Blog ─────────────────
// Verifies the ALREADY-PRESENT defensive guard (contentCalendar.service.js
// lines 50-55) — this is not a new guard, this test documents/confirms
// existing behavior per the Phase 4 audit's finding that current source
// already handles a dangling resultingBlogId correctly.

test("scheduleOpportunity: deleted Blog (resultingBlogId dangling) throws a clear 404, does not crash", async () => {
  opportunityDoc = makeOpportunity();
  blogFindByIdResult = null; // Blog was deleted; findById returns null

  await assert.rejects(
    () => scheduleOpportunity("opp123", "2026-01-01T00:00:00.000Z"),
    (err) => {
      assert.equal(err.message, "Resulting Blogs doc not found");
      assert.equal(err.statusCode, 404);
      return true;
    }
  );
  // opportunity.save() must never be called if the Blog lookup failed
  assert.equal(opportunityDoc.save.mock.callCount(), 0);
});

test("scheduleOpportunity: opportunity with no resultingBlogId throws before any Blog lookup", async () => {
  opportunityDoc = makeOpportunity({ resultingBlogId: null });
  blogFindByIdResult = undefined; // would throw if dereferenced — must not be reached

  await assert.rejects(
    () => scheduleOpportunity("opp123", "2026-01-01T00:00:00.000Z"),
    (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

// ── unscheduleOpportunity with a deleted/nonexistent Blog ───────────────

test("unscheduleOpportunity: deleted Blog (resultingBlogId dangling) throws a clear 404, does not crash", async () => {
  opportunityDoc = makeOpportunity({ status: "SCHEDULED" });
  blogFindByIdResult = null;

  await assert.rejects(
    () => unscheduleOpportunity("opp123"),
    (err) => {
      assert.equal(err.message, "Resulting Blogs doc not found");
      assert.equal(err.statusCode, 404);
      return true;
    }
  );
  assert.equal(opportunityDoc.save.mock.callCount(), 0);
});

test("unscheduleOpportunity: valid resultingBlogId clears Blog schedule and reverts opportunity.status", async () => {
  opportunityDoc = makeOpportunity({ status: "SCHEDULED" });
  blogFindByIdResult = makeBlog({ published: true, scheduledAt: new Date("2026-01-01") });

  const result = await unscheduleOpportunity("opp123");

  assert.equal(result.blog.published, false);
  assert.equal(result.blog.scheduledAt, null);
  assert.equal(result.opportunity.status, "APPROVED");
});
