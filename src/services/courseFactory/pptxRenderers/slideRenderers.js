import { BRAND, LAYOUT, addSlideChrome, contentTop } from "./theme.js";
import { drawDiagram } from "./diagrams.js";

// One renderer per slide type (Priority 4): the AI decides WHAT a slide
// communicates (title/bullets/diagram data); these functions decide HOW it
// looks (exact positions, colors, chrome). No LLM-supplied x/y/layout values
// are ever read by pptxgenjs.

const DIAGRAM_AREA = { x: LAYOUT.marginX, y: 1.85, w: 9, h: 3.2 };

function addBulletsOrBody(slide, s, top) {
  if (Array.isArray(s.bullets) && s.bullets.length > 0) {
    slide.addText(
      s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
      { x: LAYOUT.marginX + 0.1, y: top, w: 8.8, h: LAYOUT.contentBottom - top, fontSize: 17, color: BRAND.ink, fontFace: "Arial", valign: "top" }
    );
  } else if (s.body) {
    slide.addText(s.body, { x: LAYOUT.marginX + 0.1, y: top, w: 8.8, h: LAYOUT.contentBottom - top, fontSize: 17, color: BRAND.ink, fontFace: "Arial", valign: "top" });
  }
}

// Falls back to bullets/body when the AI didn't supply structured diagram
// data for a slide type that expects one — keeps generation resilient
// instead of rendering an empty content area.
function addDiagramOrFallback(slide, s, top) {
  const drew = drawDiagram(slide, s.diagram, { ...DIAGRAM_AREA, y: top });
  if (!drew) addBulletsOrBody(slide, s, top);
}

export function renderTitleSlide(pptx, s, { lessonTitle }) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.darkIndigo };
  slide.addShape("rect", { x: 0, y: LAYOUT.height - 0.1, w: LAYOUT.width, h: 0.1, fill: { color: BRAND.gold } });
  slide.addText(s.title || lessonTitle, { x: 0.7, y: 1.9, w: 8.6, h: 1.6, fontSize: 34, bold: true, color: BRAND.white, fontFace: "Arial" });
  if (s.subtitle) {
    slide.addText(s.subtitle, { x: 0.7, y: 3.25, w: 8.6, h: 0.7, fontSize: 17, color: BRAND.gold, fontFace: "Arial" });
  }
  if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  return slide;
}

export function renderConceptSlide(pptx, s, { pageNumber }) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, { title: s.title, subtitle: s.subtitle, pageNumber });
  addBulletsOrBody(slide, s, contentTop(s.subtitle));
  if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  return slide;
}

export function renderComparisonSlide(pptx, s, { pageNumber }) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, { title: s.title, subtitle: s.subtitle, pageNumber });
  addDiagramOrFallback(slide, s, contentTop(s.subtitle));
  if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  return slide;
}

export function renderProcessSlide(pptx, s, { pageNumber }) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, { title: s.title, subtitle: s.subtitle, pageNumber });
  addDiagramOrFallback(slide, s, contentTop(s.subtitle));
  if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  return slide;
}

export function renderArchitectureSlide(pptx, s, { pageNumber }) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, { title: s.title, subtitle: s.subtitle, pageNumber });
  addDiagramOrFallback(slide, s, contentTop(s.subtitle));
  if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  return slide;
}

// Generic "diagram" slide type — the diagram's own `type` field (PROCESS,
// CYCLE, TABLE, etc.) picks the actual renderer via drawDiagram().
export function renderDiagramSlide(pptx, s, { pageNumber }) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, { title: s.title, subtitle: s.subtitle, pageNumber });
  addDiagramOrFallback(slide, s, contentTop(s.subtitle));
  if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  return slide;
}

export function renderCodeSlide(pptx, s, { pageNumber }) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, { title: s.title, subtitle: s.subtitle, pageNumber, kicker: "Code" });
  const top = contentTop(s.subtitle);
  const drew = drawDiagram(slide, s.diagram, { ...DIAGRAM_AREA, y: top });
  if (!drew) {
    // Fallback: treat body as raw code text.
    drawDiagram(slide, { type: "CODE", code: s.body || (s.bullets || []).join("\n") }, { ...DIAGRAM_AREA, y: top });
  }
  if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  return slide;
}

function renderCardSlide(pptx, s, { pageNumber, kicker, accent = BRAND.violet }) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, { title: s.title, subtitle: s.subtitle, pageNumber, kicker });
  const top = contentTop(s.subtitle);
  slide.addShape("roundRect", { x: LAYOUT.marginX, y: top, w: 9, h: LAYOUT.contentBottom - top, fill: { color: BRAND.paper }, line: { color: accent, width: 1 }, rectRadius: 0.08 });
  addBulletsOrBody(slide, s, top + 0.25);
  if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  return slide;
}

export function renderExampleSlide(pptx, s, ctx) {
  return renderCardSlide(pptx, s, { ...ctx, kicker: "Example" });
}

export function renderCaseStudySlide(pptx, s, ctx) {
  return renderCardSlide(pptx, s, { ...ctx, kicker: "Case Study", accent: BRAND.gold });
}

export function renderExerciseSlide(pptx, s, ctx) {
  return renderCardSlide(pptx, s, { ...ctx, kicker: "Exercise", accent: BRAND.deepViolet });
}

export function renderSummarySlide(pptx, s, { pageNumber }) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, { title: s.title || "Key Takeaways", subtitle: s.subtitle, pageNumber });
  const top = contentTop(s.subtitle);
  const bullets = s.bullets && s.bullets.length > 0 ? s.bullets : s.body ? [s.body] : [];
  slide.addText(
    bullets.map((b) => ({ text: b, options: { bullet: { characterCode: "2713" }, breakLine: true } })),
    { x: LAYOUT.marginX + 0.1, y: top, w: 8.8, h: LAYOUT.contentBottom - top, fontSize: 17, color: BRAND.ink, fontFace: "Arial", valign: "top" }
  );
  if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  return slide;
}

// Minimal, low-density divider slides — the interactive quiz/exercise itself
// lives in the Academy player, not the deck; these are just chapter markers.
function renderDividerSlide(pptx, s, { bg, accent }) {
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  slide.addShape("rect", { x: 0, y: LAYOUT.height / 2 - 0.02, w: LAYOUT.width, h: 0.04, fill: { color: accent } });
  slide.addText(s.title || "", { x: 0.7, y: LAYOUT.height / 2 - 0.9, w: 8.6, h: 0.8, fontSize: 28, bold: true, color: BRAND.white, fontFace: "Arial", align: "center" });
  if (s.subtitle || s.body) {
    slide.addText(s.subtitle || s.body, { x: 0.7, y: LAYOUT.height / 2 + 0.2, w: 8.6, h: 0.6, fontSize: 15, color: accent, fontFace: "Arial", align: "center" });
  }
  if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  return slide;
}

export function renderQuizSlide(pptx, s) {
  return renderDividerSlide(pptx, s, { bg: BRAND.deepViolet, accent: BRAND.gold });
}

export function renderTransitionSlide(pptx, s) {
  return renderDividerSlide(pptx, s, { bg: BRAND.darkIndigo, accent: BRAND.violet });
}

export const SLIDE_RENDERERS = {
  title: renderTitleSlide,
  concept: renderConceptSlide,
  comparison: renderComparisonSlide,
  process: renderProcessSlide,
  architecture: renderArchitectureSlide,
  diagram: renderDiagramSlide,
  code: renderCodeSlide,
  example: renderExampleSlide,
  "case-study": renderCaseStudySlide,
  quiz: renderQuizSlide,
  exercise: renderExerciseSlide,
  summary: renderSummarySlide,
  transition: renderTransitionSlide,
};
