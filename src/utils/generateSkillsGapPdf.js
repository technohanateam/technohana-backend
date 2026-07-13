import PDFDocument from "pdfkit";

const VIOLET = "#7C3AED";
const DARK = "#0f172a";
const GRAY = "#64748b";

const fmtPrice = (prices) =>
  prices ? `₹${prices.inr ?? "-"} / $${prices.usd ?? "-"} / AED ${prices.aed ?? "-"}` : "";

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
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fillColor(VIOLET).fontSize(22).font("Helvetica-Bold").text("Your Personalized Learning Path");
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(13).font("Helvetica-Bold").text(`${currentRole} → ${targetRole}`);
    doc.moveDown(1);

    if (summary) {
      doc.fillColor(GRAY).fontSize(11).font("Helvetica").text(summary);
      doc.moveDown(1);
    }

    if (skillGaps.length) {
      doc.fillColor(DARK).fontSize(14).font("Helvetica-Bold").text("Skill Gaps");
      doc.moveDown(0.3);
      skillGaps.forEach((gap) => {
        doc.fillColor(DARK).fontSize(11).font("Helvetica").text(`•  ${gap}`);
      });
      doc.moveDown(1);
    }

    if (recommendedCourses.length) {
      doc.fillColor(DARK).fontSize(14).font("Helvetica-Bold").text("Recommended Courses");
      doc.moveDown(0.3);
      recommendedCourses.forEach((course) => {
        doc.fillColor(VIOLET).fontSize(12).font("Helvetica-Bold").text(course.title || "");
        const meta = [course.category, course.duration, course.difficulty].filter(Boolean).join(" · ");
        if (meta) doc.fillColor(GRAY).fontSize(10).font("Helvetica").text(meta);
        const price = fmtPrice(course.prices);
        if (price) doc.fillColor(DARK).fontSize(10).font("Helvetica").text(price);
        if (course.gapsAddressed?.length) {
          doc.fillColor(GRAY).fontSize(9).font("Helvetica-Oblique").text(`Addresses: ${course.gapsAddressed.join(", ")}`);
        }
        doc.moveDown(0.6);
      });
      doc.moveDown(0.4);
    }

    if (timeline?.description) {
      doc.fillColor(DARK).fontSize(14).font("Helvetica-Bold").text("Timeline");
      doc.moveDown(0.3);
      const weeks = timeline.totalWeeks != null ? `${timeline.totalWeeks} weeks — ` : "";
      doc.fillColor(GRAY).fontSize(11).font("Helvetica").text(`${weeks}${timeline.description}`);
      doc.moveDown(1);
    }

    if (totalCost) {
      doc.fillColor(DARK).fontSize(14).font("Helvetica-Bold").text("Estimated Total Cost");
      doc.moveDown(0.3);
      doc.fillColor(DARK).fontSize(11).font("Helvetica").text(fmtPrice(totalCost));
      doc.moveDown(1);
    }

    if (nextStep) {
      doc.fillColor(VIOLET).fontSize(12).font("Helvetica-Bold").text(`Next Step: `, { continued: true });
      doc.fillColor(DARK).font("Helvetica").text(nextStep);
    }

    doc.end();
  });
}
