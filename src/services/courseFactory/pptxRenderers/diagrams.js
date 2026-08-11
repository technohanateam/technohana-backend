import { BRAND } from "./theme.js";

// Deterministic shape-based diagram rendering (Priority 3/4 — the AI supplies
// WHAT the diagram communicates via structured slide.diagram data; these
// functions decide HOW it's drawn: exact boxes, arrows, positions, colors).
// No arbitrary LLM layout instructions ever reach pptxgenjs coordinates.

const BOX_FILL = BRAND.paper;
const BOX_LINE = { color: BRAND.violet, width: 1.25 };
const ARROW_LINE = { color: BRAND.violet, width: 1.5, endArrowType: "triangle" };

// PROCESS / FLOW / TIMELINE — a left-to-right sequence of labeled steps,
// wrapping to a second row if there are more than 4.
export function drawStepSequence(slide, steps, { x = 0.5, y = 1.75, w = 9, h = 2.6 } = {}) {
  const items = (steps || []).slice(0, 8);
  if (items.length === 0) return;

  const perRow = items.length > 4 ? Math.ceil(items.length / 2) : items.length;
  const rows = items.length > 4 ? 2 : 1;
  const rowH = h / rows;
  const boxW = w / perRow - 0.35;
  const boxH = Math.min(rowH - 0.6, 1.3);
  const gap = 0.35;

  items.forEach((step, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const boxX = x + col * (boxW + gap);
    const boxY = y + row * rowH;

    slide.addShape("roundRect", { x: boxX, y: boxY, w: boxW, h: boxH, fill: { color: BOX_FILL }, line: BOX_LINE, rectRadius: 0.08 });
    slide.addText(String(i + 1), {
      x: boxX + 0.08, y: boxY + 0.06, w: 0.4, h: 0.3,
      fontSize: 11, bold: true, color: BRAND.violet, fontFace: "Arial",
    });
    slide.addText(step.label || "", {
      x: boxX + 0.1, y: boxY + 0.32, w: boxW - 0.2, h: 0.4,
      fontSize: 13, bold: true, color: BRAND.ink, fontFace: "Arial", align: "center", valign: "top",
    });
    if (step.description) {
      slide.addText(step.description, {
        x: boxX + 0.1, y: boxY + 0.68, w: boxW - 0.2, h: boxH - 0.72,
        fontSize: 9.5, color: BRAND.slate, fontFace: "Arial", align: "center", valign: "top",
      });
    }

    // Arrow to next step in the same row; a step that's the last in its row
    // (but not the last overall) gets a short down-arrow to the next row.
    const isLastInRow = col === perRow - 1;
    const isLastItem = i === items.length - 1;
    if (!isLastItem && !isLastInRow) {
      slide.addShape("line", {
        x: boxX + boxW, y: boxY + boxH / 2, w: gap, h: 0, line: ARROW_LINE,
      });
    } else if (!isLastItem && isLastInRow) {
      slide.addShape("line", {
        x: boxX + boxW / 2, y: boxY + boxH, w: 0, h: rowH - boxH, line: ARROW_LINE,
      });
    }
  });
}

// CYCLE — same step boxes as a sequence, but the final step visually loops
// back to the first via a labeled connector underneath, so the "repeat"
// nature reads clearly without needing true circular geometry.
export function drawCycleDiagram(slide, steps, opts = {}) {
  drawStepSequence(slide, steps, opts);
  const items = (steps || []).slice(0, 8);
  if (items.length < 2) return;

  const { x = 0.5, y = 1.75, w = 9, h = 2.6 } = opts;
  const loopY = y + h + 0.15;
  slide.addShape("line", { x, y: loopY, w, h: 0, line: { ...ARROW_LINE, endArrowType: "triangle", beginArrowType: "none" } });
  slide.addText("↻ repeats", {
    x: x + w / 2 - 0.6, y: loopY + 0.03, w: 1.2, h: 0.25,
    fontSize: 10, italic: true, color: BRAND.violet, fontFace: "Arial", align: "center",
  });
}

// COMPARISON — N side-by-side columns (typically 2), each a header + bullets,
// separated by a thin vertical divider.
export function drawComparisonColumns(slide, columns, { x = 0.5, y = 1.75, w = 9, h = 3.3 } = {}) {
  const cols = (columns || []).slice(0, 3);
  if (cols.length === 0) return;
  const colW = w / cols.length - 0.3;
  const gap = 0.3;

  cols.forEach((col, i) => {
    const colX = x + i * (colW + gap);
    slide.addShape("roundRect", { x: colX, y, w: colW, h, fill: { color: BOX_FILL }, line: BOX_LINE, rectRadius: 0.06 });
    slide.addText(col.title || "", {
      x: colX + 0.2, y: y + 0.15, w: colW - 0.4, h: 0.4,
      fontSize: 15, bold: true, color: BRAND.deepViolet, fontFace: "Arial",
    });
    slide.addText(
      (col.items || []).map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
      { x: colX + 0.2, y: y + 0.65, w: colW - 0.4, h: h - 0.8, fontSize: 12.5, color: BRAND.ink, fontFace: "Arial", valign: "top" }
    );

    if (i < cols.length - 1) {
      slide.addShape("line", { x: colX + colW + gap / 2, y: y + 0.1, w: 0, h: h - 0.2, line: { color: BRAND.slateLight, width: 1 } });
    }
  });
}

// ARCHITECTURE / HIERARCHY — a uniform grid of labeled boxes. True tree
// nesting is out of scope for Phase 1 (flat grid is an accepted
// simplification per the pilot report); each box may carry a short
// description line.
export function drawBoxGrid(slide, boxes, { x = 0.5, y = 1.75, w = 9, h = 3.3, columns } = {}) {
  const items = (boxes || []).slice(0, 9);
  if (items.length === 0) return;
  const cols = columns || (items.length <= 2 ? items.length : items.length <= 4 ? 2 : 3);
  const rows = Math.ceil(items.length / cols);
  const gap = 0.3;
  const boxW = (w - gap * (cols - 1)) / cols;
  const boxH = (h - gap * (rows - 1)) / rows;

  items.forEach((box, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const boxX = x + col * (boxW + gap);
    const boxY = y + row * (boxH + gap);

    slide.addShape("roundRect", { x: boxX, y: boxY, w: boxW, h: boxH, fill: { color: BOX_FILL }, line: BOX_LINE, rectRadius: 0.08 });
    slide.addText(box.label || "", {
      x: boxX + 0.12, y: boxY + 0.1, w: boxW - 0.24, h: 0.4,
      fontSize: 13.5, bold: true, color: BRAND.ink, fontFace: "Arial", align: "center",
    });
    if (box.description) {
      slide.addText(box.description, {
        x: boxX + 0.12, y: boxY + 0.5, w: boxW - 0.24, h: boxH - 0.6,
        fontSize: 10, color: BRAND.slate, fontFace: "Arial", align: "center", valign: "top",
      });
    }
  });
}

// TABLE — native pptxgenjs table, first row treated as header.
export function drawTable(slide, rows, { x = 0.5, y = 1.75, w = 9 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const [header, ...body] = rows;
  const tableRows = [
    header.map((c) => ({ text: c, options: { bold: true, color: BRAND.white, fill: { color: BRAND.deepViolet }, fontFace: "Arial", fontSize: 12 } })),
    ...body.map((r) => r.map((c) => ({ text: c, options: { color: BRAND.ink, fontFace: "Arial", fontSize: 11.5 } }))),
  ];
  slide.addTable(tableRows, { x, y, w, border: { type: "solid", color: BRAND.slateLight, pt: 1 }, autoPage: false });
}

// Dispatches a structured slide.diagram object to the right draw function by
// its declared type — the single place that maps the AI's diagram-type
// choice to a renderer, used by every slide type that can carry a diagram.
// Returns true if something was drawn, false if `diagram` was missing/
// unrecognized (caller falls back to plain bullets).
export function drawDiagram(slide, diagram, area) {
  if (!diagram || !diagram.type) return false;
  switch (diagram.type) {
    case "PROCESS":
    case "FLOW":
    case "TIMELINE":
      drawStepSequence(slide, diagram.steps, area);
      return true;
    case "CYCLE":
      drawCycleDiagram(slide, diagram.steps, area);
      return true;
    case "COMPARISON":
      drawComparisonColumns(slide, diagram.columns, area);
      return true;
    case "ARCHITECTURE":
    case "HIERARCHY":
      drawBoxGrid(slide, diagram.boxes, area);
      return true;
    case "TABLE":
      drawTable(slide, diagram.rows, area);
      return true;
    case "CODE":
      drawCodeBlock(slide, diagram.code, { ...area, language: diagram.language });
      return true;
    default:
      return false;
  }
}

// Splits a code string into page-sized chunks by line count, so a long
// function never gets crushed into an unreadably small font or silently
// clipped — the box height/font size stay fixed (readability stays
// constant); the code splits across additional slides instead. Heuristic,
// line-count based (pptxgenjs exposes no text-measurement API to do this
// pixel-exactly), calibrated to the renderer's actual fontSize/lineSpacing/
// box height so it tracks if those ever change.
export function splitCodeIntoPages(code, { h = 3.2, fontSize = 12, lineSpacing = 16 } = {}) {
  if (!code) return [""];
  const lines = code.split("\n");
  const interiorHeightPt = (h - 0.55) * 72;
  const maxLines = Math.max(4, Math.floor(interiorHeightPt / lineSpacing) - 1); // 1-line buffer
  if (lines.length <= maxLines) return [code];
  const pages = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    pages.push(lines.slice(i, i + maxLines).join("\n"));
  }
  return pages;
}

// CODE — a single dark, monospace code block with an optional language chip.
export function drawCodeBlock(slide, code, { x = 0.5, y = 1.75, w = 9, h = 3.3, language } = {}) {
  slide.addShape("roundRect", { x, y, w, h, fill: { color: BRAND.ink }, line: { color: BRAND.ink }, rectRadius: 0.08 });
  if (language) {
    slide.addText(language.toUpperCase(), {
      x: x + w - 1.6, y: y + 0.12, w: 1.4, h: 0.28,
      fontSize: 9, bold: true, color: BRAND.gold, fontFace: "Arial", align: "right",
    });
  }
  slide.addText(code || "", {
    x: x + 0.3, y: y + 0.35, w: w - 0.6, h: h - 0.55,
    fontSize: 12, color: "E5E7EB", fontFace: "Courier New", valign: "top", lineSpacing: 16,
  });
}
