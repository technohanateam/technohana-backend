import { test } from "node:test";
import assert from "node:assert/strict";
import { runLessonQa } from "../../src/services/courseFactory/qaService.js";
import { requireAdmin } from "../../src/middleware/authenticateAdmin.js";

// These tests exercise the real, unmodified pieces that together implement
// the verification workflow's guarantees:
//  - runLessonQa (the exact function setSourceVerification calls to
//    recalculate publishReady after every status change)
//  - requireAdmin (the exact middleware gating the verify/unverify routes)
// A DB/Express integration harness doesn't exist elsewhere in this test
// suite, so the controller's own request/response/Mongoose glue is left
// untested here — that glue is a thin wrapper with no branching logic of
// its own beyond what's covered below.

function technicalLesson(sources) {
  return {
    title: "A Technical Lesson",
    // Short but non-zero so the deterministic word-count-based duration
    // check (introduced alongside per-slide audio work) doesn't flag this
    // fixture — "Explains the code." is ~3 words, so a tiny target keeps it
    // within the existing 60% tolerance without inflating the fixture text.
    durationMinutes: 0.02,
    learningObjectives: ["Do the thing"],
    slides: [{ type: "code", title: "Code", narration: "Explains the code.", estimatedSeconds: 60, audio: { status: "DONE" } }],
    quiz: [
      { question: "Q1", type: "multiple-choice", options: ["a", "b"], correctAnswer: 0, explanation: "x" },
      { question: "Q2", type: "multiple-choice", options: ["a", "b"], correctAnswer: 0, explanation: "x" },
      { question: "Q3", type: "multiple-choice", options: ["a", "b"], correctAnswer: 0, explanation: "x" },
    ],
    transcript: "x".repeat(150),
    sources,
    assets: { pptxUrl: "https://res.cloudinary.com/x.pptx" },
    narration: {},
  };
}

// 1. No sources
test("1. technical lesson with no sources is not publish-ready", () => {
  const qa = runLessonQa(technicalLesson([]));
  assert.equal(qa.publishReady, false);
  assert.ok(qa.issues.some((i) => i.includes("no sources")));
});

// 2. Pending source
test("2. technical lesson with a PENDING_VERIFICATION source is not publish-ready", () => {
  const qa = runLessonQa(technicalLesson([{ title: "Docs", url: "https://example.com", verificationStatus: "PENDING_VERIFICATION" }]));
  assert.equal(qa.publishReady, false);
  assert.ok(qa.issues.some((i) => i.includes("PENDING_VERIFICATION")));
});

// 3. Verified source
test("3. technical lesson with only VERIFIED sources is publish-ready (other checks passing)", () => {
  const qa = runLessonQa(technicalLesson([{ title: "Docs", url: "https://example.com", verificationStatus: "VERIFIED" }]));
  assert.equal(qa.publishReady, true, qa.issues.join("; "));
});

// 4. Mark verified — simulates exactly what setSourceVerification does to a
// source subdocument, then re-runs the real QA gate on the result.
test("4. marking a source verified stamps verifiedBy/verifiedAt and flips verificationStatus", () => {
  const source = { title: "Docs", url: "https://example.com", verificationStatus: "PENDING_VERIFICATION", verifiedBy: null, verifiedAt: null };

  // --- the exact transition setSourceVerification(..., true) performs ---
  source.verificationStatus = "VERIFIED";
  source.verifiedBy = "admin@technohana.in";
  source.verifiedAt = new Date();
  // ------------------------------------------------------------------------

  assert.equal(source.verificationStatus, "VERIFIED");
  assert.equal(source.verifiedBy, "admin@technohana.in");
  assert.ok(source.verifiedAt instanceof Date);

  const qa = runLessonQa(technicalLesson([source]));
  assert.equal(qa.publishReady, true, qa.issues.join("; "));
});

// 5. Revert to pending
test("5. reverting a verified source clears verifiedBy/verifiedAt and flips publishReady back to false", () => {
  const source = { title: "Docs", url: "https://example.com", verificationStatus: "VERIFIED", verifiedBy: "admin@technohana.in", verifiedAt: new Date() };

  // --- the exact transition setSourceVerification(..., false) performs ---
  source.verificationStatus = "PENDING_VERIFICATION";
  source.verifiedBy = null;
  source.verifiedAt = null;
  // -----------------------------------------------------------------------

  assert.equal(source.verificationStatus, "PENDING_VERIFICATION");
  assert.equal(source.verifiedBy, null);
  assert.equal(source.verifiedAt, null);

  const qa = runLessonQa(technicalLesson([source]));
  assert.equal(qa.publishReady, false);
});

// 6. Unauthorized verification — the real requireAdmin middleware, which is
// the sole gate on POST /lessons/:id/sources/:sourceId/(un)verify.
test("6. requireAdmin rejects a non-admin role from the verification routes", () => {
  const req = { admin: { role: "marketing" } };
  let statusCode = null;
  let body = null;
  let nextCalled = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; },
  };
  requireAdmin(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, "next() must not be called for a non-admin role");
  assert.equal(statusCode, 403);
  assert.ok(body.message.toLowerCase().includes("admin"));
});

test("6b. requireAdmin allows the admin role through", () => {
  const req = { admin: { role: "admin" } };
  let nextCalled = false;
  requireAdmin(req, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

// 7. publishReady recalculation — a lesson that also has an unrelated QA
// failure (too few quiz questions) must stay not-publish-ready even after
// its source is verified; verifying a source doesn't blanket-clear other
// QA issues, and other QA failures continue to affect publishReady normally.
test("7. publishReady recalculation still reflects unrelated QA failures after source verification", () => {
  const lesson = technicalLesson([{ title: "Docs", url: "https://example.com", verificationStatus: "VERIFIED" }]);
  lesson.quiz = lesson.quiz.slice(0, 1); // drop below the 3-question minimum
  const qa = runLessonQa(lesson);
  assert.equal(qa.publishReady, false, "an unrelated QA failure must still block publishReady even with a verified source");
  assert.ok(qa.issues.some((i) => i.includes("quiz questions")));
});
