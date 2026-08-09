import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelJson } from "../../src/utils/parseModelJson.js";

// Regression coverage for a live-validation finding (2026-08-08): a real
// content-brief LLM response failed to parse with "Expected ',' or '}' after
// property value" — a heading/example string containing a literal, unescaped
// `"` broke the control-char repair pass's naive quote-boundary tracking.
// parseModelJson now falls back to a second, stray-quote-aware repair pass
// only when the first (existing, unchanged) parse attempt fails.

test("well-formed JSON parses on the first attempt, unaffected by the fallback path", () => {
  const text = '{"title":"A normal title","tags":["a","b"]}';
  assert.deepEqual(parseModelJson(text), { title: "A normal title", tags: ["a", "b"] });
});

test("literal control characters inside a string still repair as before (pre-existing behavior)", () => {
  const text = '{"content":"line one\nline two"}';
  assert.deepEqual(parseModelJson(text), { content: "line one\nline two" });
});

test("an unescaped literal quote inside a string value is recovered by the fallback pass", () => {
  // Mirrors the real failure: a heading like `Is CISSP "worth it"?` emitted
  // with raw quotes instead of \"worth it\".
  const text = '{"heading":"Is CISSP "worth it"? A closer look","level":2}';
  const result = parseModelJson(text);
  assert.equal(result.heading, 'Is CISSP "worth it"? A closer look');
  assert.equal(result.level, 2);
});

test("an unescaped quote followed by valid JSON continuation is still treated as a real string boundary", () => {
  const text = '{"a":"value with a trailing quote\\"","b":2}';
  const result = parseModelJson(text);
  assert.equal(result.a, 'value with a trailing quote"');
  assert.equal(result.b, 2);
});

test("genuinely invalid JSON (missing closing brace content) still throws the original, more informative error", () => {
  const text = "not json at all, no braces here";
  assert.throws(() => parseModelJson(text), /No JSON object found/);
});

test("multiple stray quotes in the same string are all recovered", () => {
  const text = '{"quote":"She said "hello" and then "goodbye" quickly"}';
  const result = parseModelJson(text);
  assert.equal(result.quote, 'She said "hello" and then "goodbye" quickly');
});
