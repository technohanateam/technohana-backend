import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTableRows } from "../../src/controllers/seoReport.controller.js";

test("extractTableRows pulls Metric/Value pairs and skips the separator row", () => {
  const content = [
    "# Monthly SEO Report — July 2026",
    "",
    "| Metric | Value |",
    "|---|---|",
    "| New Opportunities Logged | 12 |",
    "| Published Links | 4 |",
    "",
    "## Published Links",
    "- example.com",
  ].join("\n");

  const rows = extractTableRows(content);
  assert.deepEqual(rows, [
    ["Metric", "Value"],
    ["New Opportunities Logged", "12"],
    ["Published Links", "4"],
  ]);
});

test("extractTableRows returns an empty array for content with no table", () => {
  assert.deepEqual(extractTableRows("# Just a heading\n\nSome text."), []);
});
