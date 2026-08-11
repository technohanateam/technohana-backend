import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCodeIntoPages } from "../../src/services/courseFactory/pptxRenderers/diagrams.js";

test("splitCodeIntoPages returns a single page for short code", () => {
  const code = "def f():\n    return 1";
  const pages = splitCodeIntoPages(code, { h: 3.2 });
  assert.equal(pages.length, 1);
  assert.equal(pages[0], code);
});

test("splitCodeIntoPages splits long code into multiple pages without losing lines", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line_${i}`);
  const code = lines.join("\n");
  const pages = splitCodeIntoPages(code, { h: 3.2 });
  assert.ok(pages.length > 1, "expected more than one page for 40 lines");

  const reassembled = pages.join("\n").split("\n");
  assert.equal(reassembled.length, lines.length, "no lines should be dropped or duplicated across pages");
  assert.deepEqual(reassembled, lines);
});

test("splitCodeIntoPages never produces an empty page for non-empty input", () => {
  const code = Array.from({ length: 50 }, (_, i) => `x${i} = ${i}`).join("\n");
  const pages = splitCodeIntoPages(code, { h: 3.2 });
  for (const page of pages) assert.ok(page.length > 0);
});

test("splitCodeIntoPages handles empty/missing code", () => {
  assert.deepEqual(splitCodeIntoPages(""), [""]);
  assert.deepEqual(splitCodeIntoPages(null), [""]);
});
