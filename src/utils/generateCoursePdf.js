import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "../assets/technohana-logo.png");

const VIOLET = "#7C3AED";
const INDIGO = "#4C1D95";
const TINT = "#f5f3ff";
const GOLD = "#FFC107";
const GOLD_TINT = "#fffbeb";
const DARK = "#0f172a";
const GRAY = "#64748b";
const BORDER = "#e2e8f0";
const CARD_BG = "#f8fafc";

const MARGIN = 48;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_TOP = PAGE_HEIGHT - 46;
const BODY = 10;

// PDFKit's built-in fonts are WinAnsi only: map common typographic characters
// and drop anything else instead of letting it render as the wrong glyph.
const clean = (v) => String(v ?? "")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[•●]/g, "-")
  .replace(/ /g, " ")
  .replace(/[^\x09\x0A\x20-\x7E\xA1-\xFF]/g, "")
  .trim();

const textHeight = (doc, text, width, font = "Helvetica", size = BODY, lineGap = 2.5) => {
  doc.font(font).fontSize(size);
  return doc.heightOfString(text, { width, lineGap });
};

function ensureSpace(doc, height) {
  if (doc.y + height > FOOTER_TOP - 12) {
    doc.addPage();
    doc.x = MARGIN;
    doc.y = MARGIN;
  }
}

function heading(doc, title) {
  ensureSpace(doc, 60);
  doc.y += 14;
  const y = doc.y;
  doc.roundedRect(MARGIN, y, 4, 16, 2).fill(VIOLET);
  doc.fillColor(INDIGO).font("Helvetica-Bold").fontSize(13).text(clean(title), MARGIN + 13, y + 1, { width: CONTENT_WIDTH - 13 });
  doc.y = y + 26;
}

const paragraph = (doc, text) => {
  const t = clean(text);
  if (!t) return;
  ensureSpace(doc, 40);
  doc.fillColor(DARK).font("Helvetica").fontSize(BODY).text(t, MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 2.5 });
  doc.y += 4;
};

const bullet = (doc, x, y, color = VIOLET) => doc.circle(x, y, 2).fill(color);

const bullets = (doc, items, { x = MARGIN, width = CONTENT_WIDTH } = {}) => {
  for (const item of items.map(clean).filter(Boolean)) {
    const h = textHeight(doc, item, width - 14);
    ensureSpace(doc, h + 6);
    const y = doc.y;
    bullet(doc, x + 4, y + 6);
    doc.fillColor(DARK).font("Helvetica").fontSize(BODY).text(item, x + 14, y, { width: width - 14, lineGap: 2.5 });
    doc.y = y + h + 4;
  }
};

const tick = (doc, x, y) => {
  doc.circle(x + 6, y + 6, 6).fill(TINT);
  doc.save().lineWidth(1.6).lineCap("round").lineJoin("round").strokeColor(VIOLET)
    .moveTo(x + 3, y + 6.3).lineTo(x + 5.3, y + 8.6).lineTo(x + 9.3, y + 3.8).stroke().restore();
};

// Two-column checklist; each row waits for its taller item so columns stay aligned.
function checklist(doc, items) {
  const list = items.map(clean).filter(Boolean);
  const gap = 18;
  const colW = (CONTENT_WIDTH - gap) / 2;
  for (let i = 0; i < list.length; i += 2) {
    const pair = list.slice(i, i + 2);
    const rowH = Math.max(...pair.map((t) => textHeight(doc, t, colW - 20)));
    ensureSpace(doc, rowH + 8);
    const y = doc.y;
    pair.forEach((t, j) => {
      const x = MARGIN + j * (colW + gap);
      tick(doc, x, y);
      doc.fillColor(DARK).font("Helvetica").fontSize(BODY).text(t, x + 20, y, { width: colW - 20, lineGap: 2.5 });
    });
    doc.y = y + rowH + 8;
  }
}

function glanceCards(doc, y, entries) {
  const gap = 10;
  const w = (CONTENT_WIDTH - gap * (entries.length - 1)) / entries.length;
  entries.forEach(([label, value], i) => {
    const x = MARGIN + i * (w + gap);
    doc.roundedRect(x, y, w, 48, 8).fill(TINT);
    doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(7.5).text(label.toUpperCase(), x + 12, y + 10, { width: w - 24, characterSpacing: 0.6, lineBreak: false });
    doc.fillColor(INDIGO).font("Helvetica-Bold").fontSize(12).text(value, x + 12, y + 25, { width: w - 24, lineBreak: false, ellipsis: true });
  });
  return y + 48;
}

function moduleCard(doc, index, module) {
  const title = clean(module.moduleTitle) || `Module ${index + 1}`;
  const topics = (module.content || []).map(clean).filter(Boolean);
  const innerW = CONTENT_WIDTH - 62;
  const titleH = textHeight(doc, title, innerW, "Helvetica-Bold", 11, 2);
  const topicsH = topics.reduce((sum, t) => sum + textHeight(doc, t, innerW - 14) + 4, 0);
  const cardH = 16 + titleH + 8 + topicsH + 8;
  const fits = cardH < 560;

  ensureSpace(doc, fits ? cardH + 10 : titleH + 60);
  const y = doc.y;
  if (fits) doc.roundedRect(MARGIN, y, CONTENT_WIDTH, cardH, 10).fillAndStroke(CARD_BG, BORDER);
  doc.circle(MARGIN + 24, y + 26, 13).fill(VIOLET);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11).text(String(index + 1), MARGIN + 11, y + 21, { width: 26, align: "center", lineBreak: false });

  doc.fillColor(INDIGO).font("Helvetica-Bold").fontSize(11).text(title, MARGIN + 50, y + 14, { width: innerW, lineGap: 2 });
  doc.y = y + 14 + titleH + 8;
  bullets(doc, topics, { x: MARGIN + 50, width: innerW });
  doc.y = Math.max(doc.y, y + (fits ? cardH : 0)) + 10;
}

function ctaBox(doc, { slug, siteUrl }) {
  const url = slug ? `${siteUrl}/courses/${slug}` : siteUrl;
  const h = 92;
  ensureSpace(doc, h + 20);
  doc.y += 18;
  const y = doc.y;
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, h, 12).fillAndStroke(GOLD_TINT, GOLD);
  doc.rect(MARGIN, y + 14, 4, h - 28).fill(GOLD);
  doc.fillColor(INDIGO).font("Helvetica-Bold").fontSize(14).text("Ready to start? Talk to our team", MARGIN + 22, y + 16, { width: CONTENT_WIDTH - 44, lineBreak: false });
  doc.fillColor(DARK).font("Helvetica").fontSize(BODY)
    .text("Batch dates, corporate and group options, and a free call with a learning advisor.", MARGIN + 22, y + 38, { width: CONTENT_WIDTH - 44, lineBreak: false });
  doc.fillColor(VIOLET).font("Helvetica-Bold").fontSize(10.5)
    .text(`${url.replace(/^https?:\/\//, "")}`, MARGIN + 22, y + 58, { width: CONTENT_WIDTH - 44, link: url, underline: true, lineBreak: false });
  doc.fillColor(GRAY).font("Helvetica").fontSize(9)
    .text("connect@technohana.in   |   WhatsApp +91 98219 67863", MARGIN + 22, y + 74, { width: CONTENT_WIDTH - 44, lineBreak: false });
  doc.y = y + h;
}

function drawFooter(doc, pageNum, total) {
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save().moveTo(MARGIN, FOOTER_TOP).lineTo(PAGE_WIDTH - MARGIN, FOOTER_TOP).lineWidth(1).strokeColor(VIOLET).opacity(0.35).stroke().restore();
  doc.fontSize(8.5).font("Helvetica").fillColor(GRAY)
    .text("technohana.in  |  connect@technohana.in  |  WhatsApp +91 98219 67863", MARGIN, FOOTER_TOP + 14, { width: CONTENT_WIDTH - 70, lineBreak: false });
  doc.text(`Page ${pageNum} of ${total}`, PAGE_WIDTH - MARGIN - 70, FOOTER_TOP + 14, { width: 70, align: "right", lineBreak: false });
  doc.page.margins.bottom = savedBottom;
}

// Course brochure. Deliberately carries NO pricing: reps share it freely and
// quote prices separately (see the recommend-course email draft).
export function generateCoursePdf(course, { siteUrl = "https://www.technohana.in" } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, bufferPages: true, size: "LETTER", info: { Title: `${clean(course.courseTitle)} - Technohana`, Author: "Technohana" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const title = clean(course.courseTitle);
      const titleH = textHeight(doc, title, CONTENT_WIDTH - 20, "Helvetica-Bold", 25, 3);
      const bandH = 118 + titleH + 28;

      // Header band: indigo-to-violet gradient with the logo on a white pill.
      const grad = doc.linearGradient(0, 0, PAGE_WIDTH, bandH);
      grad.stop(0, INDIGO).stop(1, VIOLET);
      doc.rect(0, 0, PAGE_WIDTH, bandH).fill(grad);
      doc.circle(PAGE_WIDTH - 40, -30, 130).fillOpacity(0.08).fill("#ffffff");
      doc.fillOpacity(1);

      doc.roundedRect(MARGIN, 28, 150, 36, 18).fill("#ffffff");
      try {
        doc.image(LOGO_PATH, MARGIN + 14, 38, { fit: [122, 18] });
      } catch (_) {
        doc.fillColor(VIOLET).font("Helvetica-Bold").fontSize(15).text("Techno", MARGIN + 20, 39, { continued: true, lineBreak: false }).fillColor("#E6AC00").text("hana", { lineBreak: false });
      }

      const category = clean(course.category).toUpperCase();
      if (category) doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(9).text(category, MARGIN, 88, { width: CONTENT_WIDTH, characterSpacing: 1.2, lineBreak: false });
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(25).text(title, MARGIN, 106, { width: CONTENT_WIDTH - 20, lineGap: 3 });
      doc.roundedRect(MARGIN, bandH - 22, 56, 4, 2).fill(GOLD);

      const glance = [
        ["Level", clean(course.difficulty)],
        ["Duration", clean(course.courseDays)],
        ["Hours", clean(course.courseTime)],
        ["Language", clean(course.language)],
      ].filter(([, v]) => v);
      doc.y = glance.length ? glanceCards(doc, bandH + 18, glance) + 8 : bandH + 10;

      if (course.overview) { heading(doc, "Overview"); paragraph(doc, course.overview); }
      if (course.courseObjective) { heading(doc, "Course objective"); paragraph(doc, course.courseObjective); }
      if (course.whatWillYouLearn?.length) { heading(doc, "What you will learn"); checklist(doc, course.whatWillYouLearn); }
      if (course.courseOutcomes) { heading(doc, "Outcomes"); paragraph(doc, course.courseOutcomes); }
      if (course.labs) { heading(doc, "Hands-on labs"); paragraph(doc, course.labs); }
      const prereq = Array.isArray(course.prerequisites) ? course.prerequisites : [course.prerequisites];
      if (prereq.some(Boolean)) { heading(doc, "Prerequisites"); bullets(doc, prereq); }
      if (course.targetAudience?.length) { heading(doc, "Who should attend"); bullets(doc, course.targetAudience); }
      if (course.modules?.length) {
        heading(doc, "Curriculum");
        course.modules.forEach((m, i) => moduleCard(doc, i, m));
      }

      ctaBox(doc, { slug: course.courseSlug || course.id, siteUrl });

      const count = doc.bufferedPageRange().count;
      for (let i = 0; i < count; i++) {
        doc.switchToPage(i);
        drawFooter(doc, i + 1, count);
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
