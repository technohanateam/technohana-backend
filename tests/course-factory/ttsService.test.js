import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNarration, classifyTtsError } from "../../src/services/courseFactory/ttsService.js";

test("validateNarration (slide context) flags empty text", () => {
  const result = validateNarration("", { context: "slide" });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes("empty")));
});

test("validateNarration (slide context) flags unusually short narration", () => {
  const result = validateNarration("Hi there", { context: "slide" });
  assert.ok(result.issues.some((i) => i.includes("unusually short")));
});

test("validateNarration (slide context) flags narration over 220 words", () => {
  const text = Array.from({ length: 221 }, () => "word").join(" ");
  const result = validateNarration(text, { context: "slide" });
  assert.ok(result.issues.some((i) => i.includes("unusually long")));
});

test("validateNarration (slide context) does not apply the lesson char limit", () => {
  const text = Array.from({ length: 200 }, () => "word").join(" "); // well under 220 words, but long in chars
  const result = validateNarration(text, { context: "slide" });
  assert.ok(!result.issues.some((i) => i.includes("TTS provider")));
});

test("validateNarration (lesson context) flags text over the 4096-char TTS limit", () => {
  const text = "word ".repeat(1000); // 5000 chars
  const result = validateNarration(text, { context: "lesson" });
  assert.ok(result.issues.some((i) => i.includes("exceeds the TTS provider")));
});

test("validateNarration flags control characters", () => {
  const result = validateNarration("Some narration text\x01here", { context: "slide" });
  assert.ok(result.issues.some((i) => i.includes("control characters")));
});

test("validateNarration surfaces pronunciation-sensitive terms without failing validation", () => {
  const result = validateNarration("This lesson covers RAG and LangChain in depth.", { context: "slide" });
  assert.equal(result.valid, true);
  assert.deepEqual(result.termsUsed.sort(), ["LangChain", "RAG"]);
});

test("classifyTtsError maps 401 to AUTH_FAILURE", () => {
  assert.equal(classifyTtsError({ status: 401 }), "AUTH_FAILURE");
});

test("classifyTtsError maps 403 to AUTH_FAILURE", () => {
  assert.equal(classifyTtsError({ status: 403 }), "AUTH_FAILURE");
});

test("classifyTtsError maps 429 to RATE_LIMIT", () => {
  assert.equal(classifyTtsError({ status: 429 }), "RATE_LIMIT");
});

test("classifyTtsError maps 500/503 to TRANSIENT", () => {
  assert.equal(classifyTtsError({ status: 500 }), "TRANSIENT");
  assert.equal(classifyTtsError({ status: 503 }), "TRANSIENT");
});

test("classifyTtsError maps unknown/missing status to UNKNOWN", () => {
  assert.equal(classifyTtsError({}), "UNKNOWN");
  assert.equal(classifyTtsError({ status: 418 }), "UNKNOWN");
});

test("classifyTtsError reads status from err.response.status if err.status is absent", () => {
  assert.equal(classifyTtsError({ response: { status: 401 } }), "AUTH_FAILURE");
});
