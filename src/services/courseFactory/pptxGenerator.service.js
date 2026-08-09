import pptxgen from "pptxgenjs";
import { v2 as cloudinary } from "cloudinary";

// Technohana brand tokens (CLAUDE.md — frontend brand palette).
const BRAND = {
  violet: "8B5CF6",
  deepViolet: "7C3AED",
  darkIndigo: "4C1D95",
  gold: "FFC107",
  white: "FFFFFF",
  ink: "1F1B2E",
};

function addTitleSlide(pptx, slide, lessonTitle) {
  const s = pptx.addSlide();
  s.background = { color: BRAND.darkIndigo };
  s.addText(slide.title || lessonTitle, { x: 0.6, y: 1.8, w: 9, h: 1.5, fontSize: 34, bold: true, color: BRAND.white, fontFace: "Arial" });
  if (slide.subtitle) {
    s.addText(slide.subtitle, { x: 0.6, y: 3.2, w: 9, h: 0.8, fontSize: 18, color: BRAND.gold, fontFace: "Arial" });
  }
}

function addBodySlide(pptx, slide, pageNumber) {
  const s = pptx.addSlide();
  s.background = { color: BRAND.white };
  s.addText(slide.title || "", { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 26, bold: true, color: BRAND.deepViolet, fontFace: "Arial" });

  if (slide.subtitle) {
    s.addText(slide.subtitle, { x: 0.5, y: 1.05, w: 9, h: 0.5, fontSize: 16, italic: true, color: BRAND.violet, fontFace: "Arial" });
  }

  let y = slide.subtitle ? 1.7 : 1.3;

  if (Array.isArray(slide.bullets) && slide.bullets.length > 0) {
    s.addText(
      slide.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
      { x: 0.6, y, w: 8.8, h: 4.5, fontSize: 18, color: BRAND.ink, fontFace: "Arial", valign: "top" }
    );
  } else if (slide.body) {
    s.addText(slide.body, { x: 0.6, y, w: 8.8, h: 4.5, fontSize: 18, color: BRAND.ink, fontFace: "Arial", valign: "top" });
  }

  s.addText(String(pageNumber), { x: 9.3, y: 5.3, w: 0.5, h: 0.3, fontSize: 10, color: BRAND.violet, align: "right" });

  if (slide.speakerNotes) s.addNotes(slide.speakerNotes);
}

// Builds a .pptx from the canonical lesson JSON and returns the raw buffer.
// PPTX is a generated artifact of the lesson — never edited independently
// (spec §4/§14): regenerating always re-derives from lesson.slides.
export function buildLessonPptx(lesson) {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: "TECHNOHANA_16x9", width: 10, height: 5.63 });
  pptx.layout = "TECHNOHANA_16x9";
  pptx.author = "Technohana AI Academy";
  pptx.title = lesson.title;

  const slides = [...(lesson.slides || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  slides.forEach((slide, i) => {
    if (slide.type === "title" && i === 0) {
      addTitleSlide(pptx, slide, lesson.title);
    } else {
      addBodySlide(pptx, slide, i + 1);
    }
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
