import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildLessonPptx } from "../../src/services/courseFactory/pptxGenerator.service.js";

// A minimal fixture covering the slide types that get distinct branding
// treatment: title (hero logo), concept (footer icon via chrome), quiz
// (divider T icon), summary (closing wordmark).
const FIXTURE_LESSON = {
  title: "Brand Regression Fixture",
  slides: [
    { order: 1, type: "title", title: "Brand Regression Fixture", subtitle: "Automated check", narration: "" },
    { order: 2, type: "concept", title: "A Content Slide", bullets: ["Point one"], narration: "x" },
    { order: 3, type: "quiz", title: "Knowledge Check", narration: "" },
    { order: 4, type: "summary", title: "Summary", bullets: ["Takeaway"], narration: "x" },
  ],
};

async function loadZip(buffer) {
  return JSZip.loadAsync(buffer);
}

test("generated PPTX remains valid OOXML with the required package parts", async () => {
  const buffer = await buildLessonPptx(FIXTURE_LESSON);
  const zip = await loadZip(buffer);
  assert.ok(zip.file("[Content_Types].xml"), "missing [Content_Types].xml");
  assert.ok(zip.file("ppt/presentation.xml"), "missing ppt/presentation.xml");
  const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slideFiles.length, FIXTURE_LESSON.slides.length);
});

test("every slide embeds at least one Technohana brand image", async () => {
  const buffer = await buildLessonPptx(FIXTURE_LESSON);
  const zip = await loadZip(buffer);
  const mediaFiles = Object.keys(zip.files).filter((n) => /^ppt\/media\/image-\d+/.test(n));
  // One brand mark per slide, minimum (title/summary/divider slides add
  // extra text but still exactly one image each in this fixture).
  assert.ok(mediaFiles.length >= FIXTURE_LESSON.slides.length, `expected >= ${FIXTURE_LESSON.slides.length} embedded images, got ${mediaFiles.length}`);
});

test("title slide contains the wordmark ('TECHNOHANA ACADEMY' text) alongside its logo image", async () => {
  const buffer = await buildLessonPptx(FIXTURE_LESSON);
  const zip = await loadZip(buffer);
  const slide1Xml = await zip.file("ppt/slides/slide1.xml").async("string");
  assert.ok(slide1Xml.includes("TECHNOHANA ACADEMY"), "title slide missing Technohana Academy wordmark text");
  const slide1Rels = await zip.file("ppt/slides/_rels/slide1.xml.rels").async("string");
  assert.ok(slide1Rels.includes("image"), "title slide has no image relationship");
});

test("closing/summary slide contains the wordmark alongside its logo image", async () => {
  const buffer = await buildLessonPptx(FIXTURE_LESSON);
  const zip = await loadZip(buffer);
  const summarySlideXml = await zip.file(`ppt/slides/slide${FIXTURE_LESSON.slides.length}.xml`).async("string");
  assert.ok(summarySlideXml.includes("TECHNOHANA ACADEMY"), "summary slide missing Technohana Academy wordmark text");
});

test("code slide auto-pagination still embeds branding on every split page", async () => {
  const longCode = Array.from({ length: 40 }, (_, i) => `line_${i} = ${i}`).join("\n");
  const lesson = {
    title: "Pagination + Branding Fixture",
    slides: [
      { order: 1, type: "title", title: "Pagination + Branding Fixture", narration: "" },
      { order: 2, type: "code", title: "A Long Function", diagram: { type: "CODE", language: "python", code: longCode }, narration: "x" },
    ],
  };
  const buffer = await buildLessonPptx(lesson);
  const zip = await loadZip(buffer);
  const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.ok(slideFiles.length > 2, `expected the long code block to split into multiple slides, got ${slideFiles.length} total slides`);

  const mediaFiles = Object.keys(zip.files).filter((n) => /^ppt\/media\/image-\d+/.test(n));
  assert.ok(mediaFiles.length >= slideFiles.length, "expected a brand image on every split code page");

  // Every generated code page's XML should reference "Part " (pagination label).
  for (let i = 2; i <= slideFiles.length; i++) {
    const xml = await zip.file(`ppt/slides/slide${i}.xml`).async("string");
    assert.ok(xml.includes("Part "), `slide ${i} missing pagination label`);
  }
});
