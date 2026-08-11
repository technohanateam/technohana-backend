import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSlideAudioAction, isSlideInAudioScope, shouldForceSlideAudio } from "../../src/services/courseFactory/lessonGenerationOrchestrator.service.js";

test("a slide with no narration is skipped, not attempted", () => {
  const slide = { order: 1, type: "title", narration: "", audio: { status: "PENDING" } };
  assert.equal(decideSlideAudioAction(slide), "SKIP_NO_NARRATION");
});

test("a slide with only whitespace narration is skipped", () => {
  const slide = { order: 1, type: "title", narration: "   ", audio: { status: "PENDING" } };
  assert.equal(decideSlideAudioAction(slide), "SKIP_NO_NARRATION");
});

test("a slide already DONE is skipped on a normal (non-forced) pass — idempotency", () => {
  const slide = { order: 1, type: "concept", narration: "Some real narration text.", audio: { status: "DONE" } };
  assert.equal(decideSlideAudioAction(slide, { force: false }), "SKIP_ALREADY_DONE");
});

test("a slide already DONE is regenerated when force is true", () => {
  const slide = { order: 1, type: "concept", narration: "Some real narration text.", audio: { status: "DONE" } };
  assert.equal(decideSlideAudioAction(slide, { force: true }), "GENERATE");
});

test("a PENDING slide is generated", () => {
  const slide = { order: 1, type: "concept", narration: "Some real narration text.", audio: { status: "PENDING" } };
  assert.equal(decideSlideAudioAction(slide), "GENERATE");
});

test("a FAILED slide is re-attempted on retry (idempotent partial regenerate)", () => {
  const slide = { order: 1, type: "concept", narration: "Some real narration text.", audio: { status: "FAILED", error: "timeout" } };
  assert.equal(decideSlideAudioAction(slide), "GENERATE");
});

test("slide 3 failing does not affect the decision for slides 1, 2, and 4", () => {
  const slides = [
    { order: 1, type: "concept", narration: "Text one.", audio: { status: "DONE" } },
    { order: 2, type: "concept", narration: "Text two.", audio: { status: "DONE" } },
    { order: 3, type: "concept", narration: "Text three.", audio: { status: "FAILED", error: "network error" } },
    { order: 4, type: "concept", narration: "Text four.", audio: { status: "PENDING" } },
  ];
  const actions = slides.map((s) => decideSlideAudioAction(s));
  assert.deepEqual(actions, ["SKIP_ALREADY_DONE", "SKIP_ALREADY_DONE", "GENERATE", "GENERATE"]);
});

test("re-running only re-attempts FAILED/PENDING slides, not DONE ones (idempotency)", () => {
  const slides = [
    { order: 1, type: "concept", narration: "Text one.", audio: { status: "DONE" } },
    { order: 2, type: "concept", narration: "Text two.", audio: { status: "FAILED" } },
  ];
  const toGenerate = slides.filter((s) => decideSlideAudioAction(s) === "GENERATE");
  assert.equal(toGenerate.length, 1);
  assert.equal(toGenerate[0].order, 2);
});

// --- Single-slide targeted regenerate (POST .../slides/:slideIndex/regenerate-audio) ---

test("isSlideInAudioScope: with no slideOrder target, every slide is in scope (normal full-lesson pass)", () => {
  const slides = [{ order: 1 }, { order: 2 }, { order: 3 }];
  assert.ok(slides.every((s) => isSlideInAudioScope(s, null)));
  assert.ok(slides.every((s) => isSlideInAudioScope(s, { force: true })));
});

test("isSlideInAudioScope: with a slideOrder target, only that one slide is in scope", () => {
  const slides = [{ order: 1 }, { order: 2 }, { order: 3 }];
  const inScope = slides.filter((s) => isSlideInAudioScope(s, { slideOrder: 2, force: true }));
  assert.deepEqual(inScope.map((s) => s.order), [2]);
});

test("shouldForceSlideAudio: the targeted slide is always forced, even if not explicitly requested", () => {
  const targetSlide = { order: 2 };
  assert.equal(shouldForceSlideAudio(targetSlide, { slideOrder: 2 }), true);
});

test("shouldForceSlideAudio: a full-lesson pass only forces when stepOptions.force is explicitly set", () => {
  const slide = { order: 1 };
  assert.equal(shouldForceSlideAudio(slide, null), false);
  assert.equal(shouldForceSlideAudio(slide, { force: true }), true);
});

test("a single-slide force-regenerate on an already-DONE slide overrides idempotency for that slide only", () => {
  const slides = [
    { order: 1, type: "concept", narration: "Text one.", audio: { status: "DONE" } },
    { order: 2, type: "concept", narration: "Text two.", audio: { status: "DONE" } },
  ];
  const stepOptions = { slideOrder: 1, force: true };
  const actions = slides
    .filter((s) => isSlideInAudioScope(s, stepOptions))
    .map((s) => decideSlideAudioAction(s, { force: shouldForceSlideAudio(s, stepOptions) }));
  assert.deepEqual(actions, ["GENERATE"], "only slide 1 should be in scope, and it must be forced despite being DONE");
});
