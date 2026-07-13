import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "../assets/technohana-logo.png");

const VIOLET = "#7C3AED";
const VIOLET_LIGHT = "#f0f7ff";
const INDIGO = "#4C1D95";
const GOLD = "#FFC107";
const DARK = "#0f172a";
const GRAY = "#64748b";
const BORDER = "#e2e8f0";
const CARD_BG = "#f8fafc";

const PAGE_MARGIN = 50;
const PAGE_WIDTH = 612; // Letter
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const FOOTER_HEIGHT = 46;
const FOOTER_TOP = 792 - FOOTER_HEIGHT;

// PDFKit's built-in fonts only support WinAnsi encoding, which doesn't
// include → (U+2192) or ₹ (U+20B9) — both silently render as the wrong
// glyph instead of erroring, so avoid them entirely (arrow is drawn as a
// vector shape below; rupee uses the "INR" text label).
const fmtPrice = (prices) =>
  prices
    ? `INR ${prices.inr ?? "-"} · $${prices.usd ?? "-"} · AED ${prices.aed ?? "-"}`
    : "";

// PDFKit auto-adds a page mid-draw once doc.y would overflow the bottom
// margin, which corrupts any block that mixes a pre-computed startY with
// several subsequent absolute-position .text()/.rect() calls (title lands
// on the old page, body gets silently bumped to a new one). Reserve the
// exact height a block needs up front so the page break — if any — always
// happens *before* the block starts, never in the middle of it.
function ensureSpace(doc, height) {
  if (doc.y + height > FOOTER_TOP - 10) {
    doc.addPage();
    doc.x = PAGE_MARGIN;
    doc.y = PAGE_MARGIN;
  }
}

function drawFooter(doc, pageNum) {
  // The footer band lives inside the page's bottom margin by design, which
  // would otherwise trip PDFKit's own auto-pagination guard (it adds a new
  // page rather than draw past maxY()) — relax the margin just for this draw.
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  doc
    .save()
    .moveTo(PAGE_MARGIN, FOOTER_TOP)
    .lineTo(PAGE_WIDTH - PAGE_MARGIN, FOOTER_TOP)
    .lineWidth(0.75)
    .strokeColor(BORDER)
    .stroke()
    .restore();

  doc
    .fillColor(GRAY)
    .fontSize(8.5)
    .font("Helvetica")
    .text(
      "Questions? connect@technohana.in  ·  WhatsApp +91 98219 67863  ·  technohana.in",
      PAGE_MARGIN,
      FOOTER_TOP + 14,
      { width: CONTENT_WIDTH - 60, lineBreak: false }
    );

  doc.text(`${pageNum}`, PAGE_WIDTH - PAGE_MARGIN - 20, FOOTER_TOP + 14, {
    width: 20,
    align: "right",
    lineBreak: false,
  });

  doc.page.margins.bottom = savedBottom;
}

function drawHeader(doc) {
  let logoDrawn = false;
  try {
    doc.image(LOGO_PATH, PAGE_MARGIN, 40, { width: 140 });
    logoDrawn = true;
  } catch (_) {
    // Missing/unreadable asset — fall back to a text wordmark below.
  }

  if (!logoDrawn) {
    doc
      .fillColor(VIOLET)
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("Techno", PAGE_MARGIN, 44, { continued: true })
      .fillColor(GOLD)
      .text("hana");
  }

  const ruleY = 40 + (logoDrawn ? 24 : 30) + 10;
  doc.rect(PAGE_MARGIN, ruleY, 90, 3).fill(VIOLET);
  doc.rect(PAGE_MARGIN + 90, ruleY, 30, 3).fill(GOLD);

  doc
    .fillColor(DARK)
    .fontSize(22)
    .font("Helvetica-Bold")
    .text("Your Personalized Learning Path", PAGE_MARGIN, ruleY + 16);
}

function drawPillsHorizontal(doc, currentRole, targetRole, currentWidth, targetWidth) {
  const y = doc.y + 6;
  const pillHeight = 24;
  const arrowWidth = 34;

  doc
    .roundedRect(PAGE_MARGIN, y, currentWidth, pillHeight, pillHeight / 2)
    .fill(VIOLET_LIGHT);
  doc
    .fillColor(INDIGO)
    .text(currentRole, PAGE_MARGIN, y + 6, { width: currentWidth, align: "center" });

  const arrowStartX = PAGE_MARGIN + currentWidth + 6;
  const arrowMidY = y + pillHeight / 2;
  doc
    .save()
    .moveTo(arrowStartX, arrowMidY)
    .lineTo(arrowStartX + arrowWidth - 8, arrowMidY)
    .lineWidth(1.5)
    .strokeColor(GOLD)
    .stroke()
    .restore();
  doc
    .save()
    .moveTo(arrowStartX + arrowWidth - 8, arrowMidY - 4)
    .lineTo(arrowStartX + arrowWidth, arrowMidY)
    .lineTo(arrowStartX + arrowWidth - 8, arrowMidY + 4)
    .closePath()
    .fill(GOLD)
    .restore();

  const targetX = arrowStartX + arrowWidth + 6;
  doc.roundedRect(targetX, y, targetWidth, pillHeight, pillHeight / 2).fill(VIOLET);
  doc
    .fillColor("#ffffff")
    .text(targetRole, targetX, y + 6, { width: targetWidth, align: "center" });

  doc.y = y + pillHeight + 14;
  doc.x = PAGE_MARGIN;
}

// Fallback for role names too long to fit side by side (e.g. long seniority
// titles) — stacks the pills vertically with a downward arrow between them
// instead of letting the second pill run off the right edge of the page.
function drawPillsStacked(doc, currentRole, targetRole, pillPadding) {
  const maxTextWidth = CONTENT_WIDTH - pillPadding * 2;

  const drawPill = (text, bg, textColor) => {
    doc.fontSize(11).font("Helvetica-Bold");
    const textHeight = doc.heightOfString(text, { width: maxTextWidth, align: "center" });
    const pillHeight = textHeight + 14;
    const y = doc.y;
    doc
      .roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, pillHeight, Math.min(12, pillHeight / 2))
      .fill(bg);
    doc
      .fillColor(textColor)
      .text(text, PAGE_MARGIN + pillPadding, y + 7, { width: maxTextWidth, align: "center" });
    doc.y = y + pillHeight;
    doc.x = PAGE_MARGIN;
  };

  const startY = doc.y + 6;
  doc.y = startY;
  drawPill(currentRole, VIOLET_LIGHT, INDIGO);

  const arrowX = PAGE_MARGIN + CONTENT_WIDTH / 2;
  const arrowTop = doc.y + 4;
  doc
    .save()
    .moveTo(arrowX, arrowTop)
    .lineTo(arrowX, arrowTop + 12)
    .lineWidth(1.5)
    .strokeColor(GOLD)
    .stroke()
    .restore();
  doc
    .save()
    .moveTo(arrowX - 4, arrowTop + 8)
    .lineTo(arrowX, arrowTop + 14)
    .lineTo(arrowX + 4, arrowTop + 8)
    .closePath()
    .fill(GOLD)
    .restore();
  doc.y = arrowTop + 18;

  drawPill(targetRole, VIOLET, "#ffffff");

  doc.y += 8;
  doc.x = PAGE_MARGIN;
}

function drawRolePills(doc, currentRole, targetRole) {
  const pillPadding = 12;
  const arrowWidth = 34;

  doc.fontSize(11).font("Helvetica-Bold");
  const currentWidth = doc.widthOfString(currentRole) + pillPadding * 2;
  const targetWidth = doc.widthOfString(targetRole) + pillPadding * 2;
  const fitsHorizontally = currentWidth + targetWidth + arrowWidth + 12 <= CONTENT_WIDTH;

  if (fitsHorizontally) {
    drawPillsHorizontal(doc, currentRole, targetRole, currentWidth, targetWidth);
  } else {
    drawPillsStacked(doc, currentRole, targetRole, pillPadding);
  }
}

function sectionHeading(doc, title) {
  doc.moveDown(0.6);
  // Reserve room for the heading plus the start of its first item, not
  // just the heading line — otherwise a heading can be stranded alone at
  // the bottom of a page with its content pushed to the next one.
  ensureSpace(doc, 90);
  const y = doc.y;
  doc.rect(PAGE_MARGIN, y + 2, 4, 14).fill(GOLD);
  doc
    .fillColor(DARK)
    .fontSize(14)
    .font("Helvetica-Bold")
    .text(title, PAGE_MARGIN + 12, y);
  doc.moveDown(0.4);
  doc.x = PAGE_MARGIN;
}

function bulletItem(doc, text) {
  doc.fontSize(10.5).font("Helvetica");
  const textHeight = doc.heightOfString(text, { width: CONTENT_WIDTH - 14 });
  ensureSpace(doc, textHeight + 8);

  const y = doc.y + 4;
  doc.circle(PAGE_MARGIN + 4, y, 3).fill(VIOLET);
  doc
    .fillColor(DARK)
    .text(text, PAGE_MARGIN + 14, doc.y, { width: CONTENT_WIDTH - 14 });
  doc.moveDown(0.35);
  doc.x = PAGE_MARGIN;
}

function highlightBox(doc, { title, body, accent, bg }) {
  doc.moveDown(0.6);
  doc.fontSize(10.5).font("Helvetica");
  const bodyHeight = doc.heightOfString(body, { width: CONTENT_WIDTH - 28 });
  const boxHeight = bodyHeight + 34;

  ensureSpace(doc, boxHeight + 10);
  const startY = doc.y;

  doc.save();
  doc.roundedRect(PAGE_MARGIN, startY, CONTENT_WIDTH, boxHeight, 6).fill(bg);
  doc.rect(PAGE_MARGIN, startY, 4, boxHeight).fill(accent);
  doc.restore();

  doc
    .fillColor(accent)
    .fontSize(10)
    .font("Helvetica-Bold")
    .text(title, PAGE_MARGIN + 14, startY + 10);
  doc
    .fillColor(DARK)
    .fontSize(10.5)
    .font("Helvetica")
    .text(body, PAGE_MARGIN + 14, startY + 26, { width: CONTENT_WIDTH - 28 });

  doc.y = startY + boxHeight;
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.4);
}

// Builds the "Your Learning Path" PDF from the skill-gap analysis result
// (the same object already rendered on the results page). Resolves a Buffer
// suitable for emailing as an attachment.
export function generateSkillsGapPdf({
  name,
  currentRole,
  targetRole,
  summary,
  skillGaps = [],
  recommendedCourses = [],
  timeline,
  totalCost,
  nextStep,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, bufferPages: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawHeader(doc);
    doc.y = 150;
    doc.x = PAGE_MARGIN;
    drawRolePills(doc, currentRole, targetRole);

    if (summary) {
      doc
        .fillColor(GRAY)
        .fontSize(11)
        .font("Helvetica")
        .text(summary, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.6);
      doc.x = PAGE_MARGIN;
    }

    if (skillGaps.length) {
      sectionHeading(doc, "Skill Gaps");
      skillGaps.forEach((gap) => bulletItem(doc, gap));
    }

    if (recommendedCourses.length) {
      sectionHeading(doc, "Recommended Courses");
      recommendedCourses.forEach((course, i) => {
        const badgeR = 10;
        const textX = PAGE_MARGIN + 16 + badgeR * 2;
        const textWidth = CONTENT_WIDTH - (textX - PAGE_MARGIN) - 14;
        const meta = [course.category, course.duration, course.difficulty]
          .filter(Boolean)
          .join(" · ");
        const price = fmtPrice(course.prices);
        const gapsLine = course.gapsAddressed?.length
          ? `Addresses: ${course.gapsAddressed.join(", ")}`
          : "";

        // Measure every line up front so the card's total height is known
        // before anything is drawn — required so ensureSpace can decide
        // whether the whole card needs to move to a fresh page as one unit.
        let innerHeight = doc
          .fontSize(11.5)
          .font("Helvetica-Bold")
          .heightOfString(course.title || "", { width: textWidth });
        if (meta) {
          innerHeight += doc
            .fontSize(9.5)
            .font("Helvetica")
            .heightOfString(meta, { width: textWidth });
        }
        if (price) {
          innerHeight += doc
            .fontSize(9.5)
            .font("Helvetica-Bold")
            .heightOfString(price, { width: textWidth });
        }
        if (gapsLine) {
          innerHeight += doc
            .fontSize(8.5)
            .font("Helvetica-Oblique")
            .heightOfString(gapsLine, { width: textWidth });
        }
        const cardHeight = Math.max(innerHeight + 20, badgeR * 2 + 20);

        ensureSpace(doc, cardHeight + 10);
        const cardStartY = doc.y;

        doc.save();
        doc
          .roundedRect(PAGE_MARGIN, cardStartY, CONTENT_WIDTH, cardHeight, 6)
          .fillAndStroke(CARD_BG, BORDER);
        doc.restore();

        doc.circle(PAGE_MARGIN + 16, cardStartY + 20, badgeR).fill(VIOLET);
        doc
          .fillColor("#ffffff")
          .fontSize(10)
          .font("Helvetica-Bold")
          .text(`${i + 1}`, PAGE_MARGIN + 16 - badgeR, cardStartY + 20 - 5, {
            width: badgeR * 2,
            align: "center",
          });

        doc
          .fillColor(DARK)
          .fontSize(11.5)
          .font("Helvetica-Bold")
          .text(course.title || "", textX, cardStartY + 10, { width: textWidth });

        if (meta) {
          doc
            .fillColor(GRAY)
            .fontSize(9.5)
            .font("Helvetica")
            .text(meta, textX, doc.y + 2, { width: textWidth });
        }

        if (price) {
          doc
            .fillColor(DARK)
            .fontSize(9.5)
            .font("Helvetica-Bold")
            .text(price, textX, doc.y + 2, { width: textWidth });
        }

        if (gapsLine) {
          doc
            .fillColor(GRAY)
            .fontSize(8.5)
            .font("Helvetica-Oblique")
            .text(gapsLine, textX, doc.y + 3, { width: textWidth });
        }

        doc.y = cardStartY + cardHeight + 10;
        doc.x = PAGE_MARGIN;
      });
    }

    if (timeline?.description) {
      const weeks = timeline.totalWeeks != null ? `${timeline.totalWeeks} weeks — ` : "";
      highlightBox(doc, {
        title: "TIMELINE",
        body: `${weeks}${timeline.description}`,
        accent: VIOLET,
        bg: VIOLET_LIGHT,
      });
    }

    if (totalCost) {
      highlightBox(doc, {
        title: "ESTIMATED TOTAL COST",
        body: fmtPrice(totalCost),
        accent: VIOLET,
        bg: VIOLET_LIGHT,
      });
    }

    if (nextStep) {
      highlightBox(doc, {
        title: "NEXT STEP",
        body: nextStep,
        accent: "#B45309",
        bg: "#FFFBEB",
      });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      drawFooter(doc, i + 1);
    }

    doc.end();
  });
}
