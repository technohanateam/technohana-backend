import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureSteps, getStep, markStepDone } from "../../src/services/courseFactory/lessonGenerationOrchestrator.service.js";

// Plain mock job object — no DB/queue mocking exists elsewhere in this
// codebase, so markStepDone's own async `.save()` call is a no-op here,
// letting these tests exercise the real cost-accounting logic directly.
function mockJob() {
  const job = { steps: [], totalTokens: 0, totalCostUsd: 0, save: async () => {} };
  ensureSteps(job);
  return job;
}

const CLAUDE_RESULT = { model: "claude-sonnet-4-6", usage: { input_tokens: 2172, output_tokens: 11133 } };

test("a single CONTENT call is counted exactly once in job.totalCostUsd", async () => {
  const job = mockJob();
  await markStepDone(job, "CONTENT", CLAUDE_RESULT);
  const expectedCost = getStep(job, "CONTENT").estimatedCostUsd;

  assert.ok(expectedCost > 0, "expected a nonzero cost for a real Claude call");
  assert.equal(job.totalCostUsd, expectedCost);
  assert.equal(job.totalTokens, CLAUDE_RESULT.usage.input_tokens + CLAUDE_RESULT.usage.output_tokens);
});

test("derived steps (SLIDES/QUIZ/EXERCISE/INSTRUCTOR_NOTES/TRANSCRIPT) contribute $0 when marked done with an empty result", async () => {
  const job = mockJob();
  await markStepDone(job, "CONTENT", CLAUDE_RESULT);
  const afterContent = job.totalCostUsd;

  for (const derived of ["SLIDES", "QUIZ", "EXERCISE", "INSTRUCTOR_NOTES", "TRANSCRIPT"]) {
    await markStepDone(job, derived, {}); // the real orchestrator's fixed call shape
  }

  for (const derived of ["SLIDES", "QUIZ", "EXERCISE", "INSTRUCTOR_NOTES", "TRANSCRIPT"]) {
    assert.equal(getStep(job, derived).estimatedCostUsd, 0, `${derived} should cost $0`);
  }
  assert.equal(job.totalCostUsd, afterContent, "job total must not grow past the one real CONTENT call's cost");
});

test("regression guard: reusing the CONTENT result for derived steps (the old bug) would inflate cost ~6x", async () => {
  const job = mockJob();
  await markStepDone(job, "CONTENT", CLAUDE_RESULT);
  const singleCallCost = job.totalCostUsd;

  // Simulates the OLD buggy call shape directly to prove the fixed shape
  // (tested above) is materially different, not accidentally equivalent.
  for (const derived of ["SLIDES", "QUIZ", "EXERCISE", "INSTRUCTOR_NOTES", "TRANSCRIPT"]) {
    await markStepDone(job, derived, CLAUDE_RESULT);
  }

  assert.equal(job.totalCostUsd, singleCallCost * 6);
});

test("resetting a step for retry subtracts its previous cost before it's re-run", async () => {
  const job = mockJob();
  await markStepDone(job, "CONTENT", CLAUDE_RESULT);
  assert.ok(job.totalCostUsd > 0);

  // Mirrors retryLessonFromStep's reset loop for a single step.
  const step = getStep(job, "CONTENT");
  job.totalCostUsd = Math.max(0, job.totalCostUsd - (step.estimatedCostUsd || 0));
  job.totalTokens = Math.max(0, job.totalTokens - ((step.tokensIn || 0) + (step.tokensOut || 0)));
  step.status = "PENDING";
  step.estimatedCostUsd = 0;
  step.tokensIn = 0;
  step.tokensOut = 0;

  assert.equal(job.totalCostUsd, 0);
  assert.equal(job.totalTokens, 0);

  // Re-running CONTENT after the reset must land back at exactly one call's
  // cost, not two calls' worth (proves no compounding across the retry).
  await markStepDone(job, "CONTENT", CLAUDE_RESULT);
  assert.equal(job.totalCostUsd, getStep(job, "CONTENT").estimatedCostUsd);
});
