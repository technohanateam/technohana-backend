import { test } from "node:test";
import assert from "node:assert/strict";
import { runLessonQa } from "../../src/services/courseFactory/qaService.js";

function baseLesson(overrides = {}) {
  return {
    title: "Intro to RAG",
    durationMinutes: 15,
    learningObjectives: ["Explain RAG", "Identify when to use it"],
    slides: [
      { title: "RAG", narration: "Retrieval-Augmented Generation lets a model use external documents to answer questions accurately.", estimatedSeconds: 900 },
    ],
    quiz: [
      { question: "When is RAG useful?", type: "multiple-choice", options: ["a", "b"], correctAnswer: 0, explanation: "Because..." },
      { question: "Q2", type: "multiple-choice", options: ["a", "b"], correctAnswer: 1, explanation: "Because..." },
      { question: "Q3", type: "multiple-choice", options: ["a", "b"], correctAnswer: 0, explanation: "Because..." },
    ],
    transcript: "x".repeat(150),
    sources: [],
    assets: { pptxUrl: "https://res.cloudinary.com/x.pptx" },
    narration: { audioUrl: "https://res.cloudinary.com/x.mp3" },
    ...overrides,
  };
}

test("runLessonQa passes a well-formed lesson", () => {
  const result = runLessonQa(baseLesson());
  assert.equal(result.passed, true, result.issues.join("; "));
  assert.equal(result.qualityScore, 100);
});

test("runLessonQa flags a slide whose narration just repeats the title", () => {
  const lesson = baseLesson({ slides: [{ title: "RAG", narration: "RAG", estimatedSeconds: 30 }] });
  const result = runLessonQa(lesson);
  assert.ok(result.issues.some((i) => i.includes("narration")));
  assert.equal(result.passed, false);
});

test("runLessonQa flags too few quiz questions", () => {
  const lesson = baseLesson({ quiz: [{ question: "Q1", type: "multiple-choice", options: ["a", "b"], correctAnswer: 0, explanation: "x" }] });
  const result = runLessonQa(lesson);
  assert.ok(result.issues.some((i) => i.includes("quiz questions")));
});

test("runLessonQa flags missing PPTX/audio assets", () => {
  const lesson = baseLesson({ assets: {}, narration: {} });
  const result = runLessonQa(lesson);
  assert.ok(result.issues.some((i) => i.includes("PPTX")));
  assert.ok(result.issues.some((i) => i.includes("Audio")));
});
