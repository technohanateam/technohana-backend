import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "../assets/technohana-logo.png");

const VIOLET = "#7C3AED";
const GOLD = "#FFC107";
const DARK = "#0f172a";
const GRAY = "#64748b";
const BORDER = "#e2e8f0";

const MARGIN = 50;
const PAGE_WIDTH = 612;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_TOP = 792 - 46;

// PDFKit's built-in fonts are WinAnsi only: map common typographic characters
// and drop anything else instead of letting it render as the wrong glyph.
const clean = (v) => String(v ?? "")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[•●]/g, "-")
  .replace(/ /g, " ")
  .replace(/[^\x09\x0A\x20-\x7E\xA1-\xFF]/g, "")
  .trim();

function ensureSpace(doc, height) {
  if (doc.y + height > FOOTER_TOP - 10) {
    doc.addPage();
    doc.x = MARGIN;
    doc.y = MARGIN;
  }
}

function heading(doc, title) {
  ensureSpace(doc, 50);
  doc.moveDown(0.8);
  doc.fillColor(VIOLET).font("Helvetica-Bold").fontSize(12).text(title.toUpperCase(), MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.3);
  doc.fillColor(DARK).font("Helvetica").fontSize(10.5);
}

const paragraph = (doc, text) => {
  const t = clean(text);
  if (!t) return;
  ensureSpace(doc, 30);
  doc.fillColor(DARK).font("Helvetica").fontSize(10.5).text(t, MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 2 });
};

const bullets = (doc, items) => {
  for (const item of items.map(clean).filter(Boolean)) {
    ensureSpace(doc, 24);
    doc.fillColor(DARK).font("Helvetica").fontSize(10.5).text(`-  ${item}`, MARGIN + 6, doc.y, { width: CONTENT_WIDTH - 6, lineGap: 2 });
    doc.moveDown(0.15);
  }
};

function drawFooter(doc, pageNum) {
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save().moveTo(MARGIN, FOOTER_TOP).lineTo(PAGE_WIDTH - MARGIN, FOOTER_TOP).lineWidth(0.75).strokeColor(BORDER).stroke().restore();
  doc.fontSize(8.5).font("Helvetica").fillColor(GRAY)
    .text("technohana.in  |  connect@technohana.in  |  WhatsApp +91 98219 67863", MARGIN, FOOTER_TOP + 14, { width: CONTENT_WIDTH - 50, lineBreak: false });
  doc.text(String(pageNum), PAGE_WIDTH - MARGIN - 40, FOOTER_TOP + 14, { width: 40, align: "right", lineBreak: false });
  doc.page.margins.bottom = savedBottom;
}

// One-to-two page course brochure. Deliberately carries NO pricing: reps share
// it freely and quote prices separately (see the recommend-course email draft).
export function generateCoursePdf(course, { siteUrl = "https://www.technohana.in" } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, bufferPages: true });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      doc.image(LOGO_PATH, MARGIN, 40, { width: 140 });
    } catch (_) {
      doc.fillColor(VIOLET).fontSize(20).font("Helvetica-Bold").text("Techno", MARGIN, 44, { continued: true }).fillColor(GOLD).text("hana");
    }
    doc.rect(MARGIN, 76, 90, 3).fill(VIOLET);
    doc.rect(MARGIN + 90, 76, 30, 3).fill(GOLD);

    doc.fillColor(DARK).font("Helvetica-Bold").fontSize(20).text(clean(course.courseTitle), MARGIN, 94, { width: CONTENT_WIDTH });
    const meta = [course.category, course.difficulty, course.courseDays, course.courseTime, course.language].map(clean).filter(Boolean).join("   |   ");
    if (meta) doc.moveDown(0.3).fillColor(GRAY).font("Helvetica").fontSize(10).text(meta, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.5);

    if (course.overview) { heading(doc, "Overview"); paragraph(doc, course.overview); }
    if (course.courseObjective) { heading(doc, "Course objective"); paragraph(doc, course.courseObjective); }
    if (course.whatWillYouLearn?.length) { heading(doc, "What you will learn"); bullets(doc, course.whatWillYouLearn); }
    if (course.courseOutcomes) { heading(doc, "Outcomes"); paragraph(doc, course.courseOutcomes); }
    if (course.labs) { heading(doc, "Hands-on labs"); paragraph(doc, course.labs); }
    const prereq = Array.isArray(course.prerequisites) ? course.prerequisites : [course.prerequisites];
    if (prereq.some(Boolean)) { heading(doc, "Prerequisites"); bullets(doc, prereq); }
    if (course.targetAudience?.length) { heading(doc, "Who should attend"); bullets(doc, course.targetAudience); }
    if (course.modules?.length) {
      heading(doc, "Curriculum");
      for (const m of course.modules) {
        ensureSpace(doc, 30);
        doc.fillColor(DARK).font("Helvetica-Bold").fontSize(10.5).text(clean(m.moduleTitle), MARGIN, doc.y, { width: CONTENT_WIDTH });
        bullets(doc, m.content || []);
      }
    }

    const slug = course.courseSlug || course.id;
    if (slug) {
      ensureSpace(doc, 40);
      doc.moveDown(1).fillColor(VIOLET).font("Helvetica-Bold").fontSize(10.5)
        .text(`Full details: ${siteUrl}/courses/${slug}`, MARGIN, doc.y, { width: CONTENT_WIDTH, link: `${siteUrl}/courses/${slug}`, underline: true });
    }

    const count = doc.bufferedPageRange().count;
    for (let i = 0; i < count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, i + 1);
    }
    doc.end();
  });
}
