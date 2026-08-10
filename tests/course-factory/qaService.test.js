import { test } from "node:test";
import assert from "node:assert/strict";
import { runLessonQa } from "../../src/services/courseFactory/qaService.js";

function baseLesson(overrides = {}) {
  return {
    title: "Intro to RAG",
    durationMinutes: 15,
    learningObjectives: ["Explain RAG", "Identify when to use it"],
    slides: [
      { type: "concept", title: "RAG", narration: "Retrieval-Augmented Generation lets a model use external documents to answer questions accurately.", estimatedSeconds: 900 },
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
  const lesson = baseLesson({ slides: [{ type: "concept", title: "RAG", narration: "RAG", estimatedSeconds: 30 }] });
  const result = runLessonQa(lesson);
  assert.ok(result.issues.some((i) => i.includes("narration")));
  assert.equal(result.passed, false);
});

test("runLessonQa does not flag missing narration on title/quiz/exercise/transition slides", () => {
  const lesson = baseLesson({
    slides: [
      { type: "concept", title: "RAG", narration: "Retrieval-Augmented Generation lets a model use external documents.", estimatedSeconds: 900 },
      { type: "title", title: "Intro", narration: "", estimatedSeconds: 0 },
      { type: "quiz", title: "Knowledge Check", narration: "", estimatedSeconds: 0 },
      { type: "exercise", title: "Try It", narration: "", estimatedSeconds: 0 },
      { type: "transition", title: "Up Next", narration: "", estimatedSeconds: 0 },
    ],
  });
  const result = runLessonQa(lesson);
  assert.ok(!result.issues.some((i) => i.includes("no narration")), result.issues.join("; "));
});

test("runLessonQa flags missing narration on a concept/process/architecture slide", () => {
  const lesson = baseLesson({ slides: [{ type: "process", title: "The Loop", narration: "", estimatedSeconds: 60 }] });
  const result = runLessonQa(lesson);
  assert.ok(result.issues.some((i) => i.includes("no narration")));
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

test("runLessonQa flags a technical lesson (code/architecture slide) with no sources as not publish-ready", () => {
  const lesson = baseLesson({
    slides: [{ type: "code", title: "Minimal Agent Loop", narration: "Walkthrough of the loop.", estimatedSeconds: 60 }],
    sources: [],
  });
  const result = runLessonQa(lesson);
  assert.ok(result.issues.some((i) => i.includes("no sources")));
  assert.equal(result.publishReady, false);
});

test("runLessonQa flags a technical lesson with only PENDING_VERIFICATION sources as not publish-ready", () => {
  const lesson = baseLesson({
    slides: [{ type: "architecture", title: "Components", narration: "The four components.", estimatedSeconds: 60 }],
    sources: [{ title: "LangChain Docs", url: "https://python.langchain.com/docs", verificationStatus: "PENDING_VERIFICATION" }],
  });
  const result = runLessonQa(lesson);
  assert.ok(result.issues.some((i) => i.includes("PENDING_VERIFICATION")));
  assert.equal(result.publishReady, false);
});

test("runLessonQa marks a technical lesson publish-ready once all sources are VERIFIED", () => {
  const lesson = baseLesson({
    slides: [{ type: "code", title: "Minimal Agent Loop", narration: "Walkthrough of the loop.", estimatedSeconds: 60 }],
    sources: [{ title: "LangChain Docs", url: "https://python.langchain.com/docs", verificationStatus: "VERIFIED" }],
    assets: { pptxUrl: "https://res.cloudinary.com/x.pptx" },
    narration: { audioUrl: "https://res.cloudinary.com/x.mp3" },
  });
  const result = runLessonQa(lesson);
  assert.equal(result.publishReady, true, result.issues.join("; "));
});

test("runLessonQa does not require sources for a non-technical lesson", () => {
  const result = runLessonQa(baseLesson()); // default slide type is "concept", no sources
  assert.equal(result.publishReady, true, result.issues.join("; "));
});
