import { test, mock } from "node:test";
import assert from "node:assert/strict";
import SeoReport from "../../src/models/seoReport.model.js";
import { extractTableRows, downloadReportCsv } from "../../src/controllers/seoReport.controller.js";

test("extractTableRows pulls only data rows — excludes both the header row and the separator row", () => {
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
    ["New Opportunities Logged", "12"],
    ["Published Links", "4"],
  ]);
});

test("extractTableRows returns an empty array for content with no table", () => {
  assert.deepEqual(extractTableRows("# Just a heading\n\nSome text."), []);
});

test("downloadReportCsv never duplicates the Metric/Value header row", async () => {
  const content = [
    "# Monthly SEO Report — July 2026",
    "",
    "| Metric | Value |",
    "|---|---|",
    "| New Opportunities Logged | 12 |",
    "| Published Links | 4 |",
  ].join("\n");

  mock.method(SeoReport, "findById", () => ({ lean: async () => ({ title: "Monthly SEO Report", content }) }));

  const req = { params: { id: "abc" } };
  let sentBody;
  const res = {
    setHeader: () => {},
    send: (body) => { sentBody = body; },
    status: () => res,
    json: () => {},
  };

  await downloadReportCsv(req, res);

  const lines = sentBody.split("\n");
  assert.equal(lines[0], "Metric,Value");
  assert.equal(lines.filter((l) => l === "Metric,Value" || l === '"Metric","Value"').length, 1, "header must appear exactly once");
  assert.equal(lines.length, 3); // header + 2 data rows
});
