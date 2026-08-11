import { test } from "node:test";
import assert from "node:assert/strict";
import { runLessonQa } from "../../src/services/courseFactory/qaService.js";

function baseLesson(overrides = {}) {
  return {
    title: "Test Lesson",
    learningObjectives: ["Understand X"],
    durationMinutes: 10,
    slides: [],
    quiz: [
      { type: "true-false", correctAnswer: true, explanation: "because" },
      { type: "true-false", correctAnswer: true, explanation: "because" },
      { type: "true-false", correctAnswer: true, explanation: "because" },
    ],
    transcript: "x".repeat(150),
    sources: [],
    assets: { pptxUrl: "https://example.com/x.pptx" },
    narration: { audioUrl: "https://example.com/x.mp3" },
    ...overrides,
  };
}

function narrationOfWordCount(n) {
  return Array.from({ length: n }, () => "word").join(" ");
}

test("durationReport reflects target/actual/diff/percentage within tolerance", () => {
  // 10 min target, 150 wpm setting -> 1500 words lands exactly on target.
  const lesson = baseLesson({
    durationMinutes: 10,
    slides: [{ order: 1, type: "concept", narration: narrationOfWordCount(1500) }],
  });
  const qa = runLessonQa(lesson, { narrationWordsPerMinute: 150 });

  assert.equal(qa.durationReport.targetMinutes, 10);
  assert.equal(qa.durationReport.actualMinutes, 10);
  assert.equal(qa.durationReport.differenceMinutes, 0);
  assert.equal(qa.durationReport.percentageDeviation, 0);
  assert.equal(qa.durationReport.withinTolerance, true);
  assert.equal(qa.durationReport.actualSource, "narration-word-count");
  assert.ok(!qa.issues.some((i) => i.includes("Narration duration")));
});

test("a lesson far exceeding its target duration is flagged in issues", () => {
  // 10 min target, 150 wpm -> 4500 words = 30 min actual, 200% deviation, over the 60% tolerance.
  const lesson = baseLesson({
    durationMinutes: 10,
    slides: [{ order: 1, type: "concept", narration: narrationOfWordCount(4500) }],
  });
  const qa = runLessonQa(lesson, { narrationWordsPerMinute: 150 });

  assert.equal(qa.durationReport.actualMinutes, 30);
  assert.equal(qa.durationReport.withinTolerance, false);
  assert.ok(qa.issues.some((i) => i.includes("Narration duration")));
});

test("duration calculation uses narration word count, not the AI's estimatedSeconds guess", () => {
  // estimatedSeconds wildly disagrees with narration word count; word count must win.
  const lesson = baseLesson({
    durationMinutes: 10,
    slides: [
      { order: 1, type: "concept", narration: narrationOfWordCount(1500), estimatedSeconds: 5 },
    ],
  });
  const qa = runLessonQa(lesson, { narrationWordsPerMinute: 150 });

  assert.equal(qa.durationReport.actualMinutes, 10, "should ignore estimatedSeconds entirely and use word count");
});

test("defaults narrationWordsPerMinute to 150 when no options passed (backward compatible signature)", () => {
  const lesson = baseLesson({
    durationMinutes: 10,
    slides: [{ order: 1, type: "concept", narration: narrationOfWordCount(1500) }],
  });
  const qa = runLessonQa(lesson);
  assert.equal(qa.durationReport.actualMinutes, 10);
});
