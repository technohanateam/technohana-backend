import pptxgen from "pptxgenjs";
import { v2 as cloudinary } from "cloudinary";
import { LAYOUT } from "./pptxRenderers/theme.js";
import { SLIDE_RENDERERS, renderConceptSlide } from "./pptxRenderers/slideRenderers.js";

// Builds a .pptx from the canonical lesson JSON and returns the raw buffer.
// PPTX is a generated artifact of the lesson — never edited independently
// (spec §4/§14): regenerating always re-derives from lesson.slides. Slide-
// type -> renderer dispatch lives in pptxRenderers/slideRenderers.js
// (Priority 4: the AI decides WHAT, the renderer decides HOW).
export function buildLessonPptx(lesson) {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: "TECHNOHANA_16x9", width: LAYOUT.width, height: LAYOUT.height });
  pptx.layout = "TECHNOHANA_16x9";
  pptx.author = "Technohana AI Academy";
  pptx.title = lesson.title;

  // A running physical page counter, not the JSON slide index — a single
  // JSON slide (e.g. a long CODE block) can render as more than one actual
  // pptx slide (see renderCodeSlide's auto-pagination), so page numbers must
  // track actual output slides or two pages end up sharing one number.
  const slides = [...(lesson.slides || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  let pageCounter = 0;
  slides.forEach((slide) => {
    const renderer = SLIDE_RENDERERS[slide.type] || renderConceptSlide;
    const result = renderer(pptx, slide, { pageNumber: pageCounter + 1, lessonTitle: lesson.title });
    pageCounter += Array.isArray(result) ? result.length : 1;
  });

  return pptx.write({ outputType: "nodebuffer" });
}

// Uploads a generated pptx buffer to Cloudinary — same memory-buffer ->
// upload_stream pattern as instructor.routes.js's resume upload, resource_type
// "raw" (matches how other non-image docs are stored).
export async function uploadLessonPptx(buffer, lessonSlug) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "technohana/academy/pptx", resource_type: "raw", public_id: `${lessonSlug}-${Date.now()}`, format: "pptx" },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

export async function generateAndUploadPptx(lesson) {
  const buffer = await buildLessonPptx(lesson);
  const result = await uploadLessonPptx(buffer, lesson.slug);
  return { url: result.secure_url, publicId: result.public_id };
}
