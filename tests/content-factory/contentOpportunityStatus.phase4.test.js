import { test } from "node:test";
import assert from "node:assert/strict";
import ContentOpportunity from "../../src/models/contentOpportunity.model.js";

const statusPath = ContentOpportunity.schema.path("status");

// Phase 4A follow-up: the production data-safety check
// (ContentOpportunity.countDocuments({status:"PUBLISHED"})) was run manually
// against the staging/production database and returned 0 documents, clearing
// the gate documented in the Phase 4 plan §12. "PUBLISHED" has now been
// removed from the enum — it was always a dead value (no code path in this
// repo ever assigned it; live publication state lives solely on
// Blog.published/Blog.scheduledAt).
test("PUBLISHED is NOT an allowed ContentOpportunity status", () => {
  assert.ok(
    !statusPath.enumValues.includes("PUBLISHED"),
    "PUBLISHED should have been removed from the enum after the data-safety audit confirmed 0 documents use it"
  );
});

test("all legitimate ContentOpportunity status values remain unchanged", () => {
  const expected = [
    "PLANNED", "SELECTED", "GENERATING", "AWAITING_INPUT", "AI_REVIEW",
    "HUMAN_REVIEW", "NEEDS_REVISION", "APPROVED", "REJECTED", "SCHEDULED",
    "FAILED",
  ];
  assert.deepEqual(statusPath.enumValues, expected);
});

test("saving a ContentOpportunity with status PUBLISHED now fails schema validation", () => {
  const doc = new ContentOpportunity({
    title: "test",
    contentType: "HOW_TO",
    status: "PUBLISHED",
  });
  const err = doc.validateSync();
  assert.ok(err, "validation should fail for a removed enum value");
  assert.ok(err.errors.status, "the status field specifically should be invalid");
});
