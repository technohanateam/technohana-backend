import { test } from "node:test";
import assert from "node:assert/strict";
import ContentOpportunity from "../../src/models/contentOpportunity.model.js";

const statusPath = ContentOpportunity.schema.path("status");

// Phase 4A: the "PUBLISHED" enum-removal step is GATED on a production
// data-safety check (ContentOpportunity.countDocuments({status:"PUBLISHED"}))
// that could not be run in this environment (no MONGO_DB configured). The
// enum removal was therefore intentionally NOT performed in this pass — see
// the Phase 4A implementation report. This test documents and locks in the
// current (unchanged) state so a future removal is a deliberate, visible
// diff against this test, not a silent behavior change.
test("PUBLISHED enum removal is gated and NOT yet performed — status still accepts PUBLISHED", () => {
  assert.ok(
    statusPath.enumValues.includes("PUBLISHED"),
    "PUBLISHED must remain in the enum until the production data-safety audit (see Phase 4 plan §12) confirms 0 documents use it"
  );
});

// Independent of enum removal: confirm (as the Phase 4 audit found) that no
// code path in the write functions this repo owns ever assigns PUBLISHED —
// this is a static assertion on the enum's declared values, the runtime
// behavior itself was verified by reading humanReview.controller.js and
// contentCalendar.service.js directly (see audit).
test("ContentOpportunity.status enum still contains all pre-existing pipeline/review values", () => {
  const expected = [
    "PLANNED", "SELECTED", "GENERATING", "AWAITING_INPUT", "AI_REVIEW",
    "HUMAN_REVIEW", "NEEDS_REVISION", "APPROVED", "REJECTED", "SCHEDULED",
    "PUBLISHED", "FAILED",
  ];
  for (const value of expected) {
    assert.ok(statusPath.enumValues.includes(value), `enum should still include ${value}`);
  }
});
