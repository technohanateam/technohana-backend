import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPageData, computeIssues, ISSUE } from "../../src/services/seoCrawler.js";

const ORIGIN = "https://example.com";

test("extractPageData parses title, meta, canonical, h1s, links, images", () => {
  const html = `
    <html><head>
      <title>Hello World</title>
      <meta name="description" content="A short description.">
      <link rel="canonical" href="https://example.com/page">
    </head><body>
      <h1>Main heading</h1>
      <p>${"word ".repeat(50)}</p>
      <a href="/internal">Internal</a>
      <a href="https://other.com/external">External</a>
      <img src="/img.jpg" alt="An image">
      <img src="/no-alt.jpg">
    </body></html>
  `;
  const page = extractPageData(html, "https://example.com/page", 200, 500, ORIGIN);

  assert.equal(page.title, "Hello World");
  assert.equal(page.metaDescription, "A short description.");
  assert.equal(page.canonicalUrl, "https://example.com/page");
  assert.deepEqual(page.h1Tags, ["Main heading"]);
  assert.equal(page.internalLinks.length, 1);
  assert.equal(page.externalLinks.length, 1);
  assert.equal(page.images.length, 2);
  assert.equal(page.images.filter((i) => !i.alt).length, 1);
});

test("computeIssues flags missing title, meta, h1, canonical, thin content", () => {
  const page = {
    title: "",
    titleLength: 0,
    metaDescription: "",
    metaDescriptionLength: 0,
    h1Tags: [],
    canonicalUrl: "",
    isNoindex: false,
    wordCount: 10,
    loadTimeMs: 500,
    brokenLinks: [],
    images: [],
  };
  const issues = computeIssues(page);

  assert.ok(issues.includes(ISSUE.MISSING_TITLE));
  assert.ok(issues.includes(ISSUE.MISSING_META_DESCRIPTION));
  assert.ok(issues.includes(ISSUE.MISSING_H1));
  assert.ok(issues.includes(ISSUE.MISSING_CANONICAL));
  assert.ok(issues.includes(ISSUE.THIN_CONTENT));
});

test("computeIssues flags multiple H1s, broken links, missing alt, slow pages", () => {
  const page = {
    title: "OK Title",
    titleLength: 8,
    metaDescription: "OK description",
    metaDescriptionLength: 14,
    h1Tags: ["First", "Second"],
    canonicalUrl: "https://example.com/page",
    isNoindex: false,
    wordCount: 500,
    loadTimeMs: 5000,
    brokenLinks: ["https://example.com/dead"],
    images: [{ src: "a.jpg", alt: "" }],
  };
  const issues = computeIssues(page);

  assert.ok(issues.includes(ISSUE.MULTIPLE_H1));
  assert.ok(issues.includes(ISSUE.BROKEN_LINK));
  assert.ok(issues.includes(ISSUE.MISSING_ALT));
  assert.ok(issues.includes(ISSUE.SLOW_PAGE));
});

test("computeIssues returns no issues for a clean page", () => {
  const page = {
    title: "Good Title",
    titleLength: 10,
    metaDescription: "Good description under 160 chars.",
    metaDescriptionLength: 34,
    h1Tags: ["Only heading"],
    canonicalUrl: "https://example.com/page",
    isNoindex: false,
    wordCount: 500,
    loadTimeMs: 500,
    brokenLinks: [],
    images: [{ src: "a.jpg", alt: "described" }],
  };
  const issues = computeIssues(page);
  assert.deepEqual(issues, []);
});
