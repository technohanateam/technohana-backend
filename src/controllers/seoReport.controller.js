import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import SeoReport from "../models/seoReport.model.js";

const BACKLINK_DIR = process.env.BACKLINK_STRATEGY_DIR || path.resolve("../technohana-frontend-master/backlink-strategy");

const resolveReportPath = (report) => {
  // weekly snapshot reports live at the folder root, monthly/quarterly under reports/
  return report.type === "weekly" ? path.join(BACKLINK_DIR, report.file) : path.join(BACKLINK_DIR, "reports", report.file);
};

export const getReports = async (req, res) => {
  try {
    const { type } = req.query;
    const filter = type ? { type } : {};
    const data = await SeoReport.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching SEO reports:", error);
    return res.status(500).json({ success: false, message: "Error fetching SEO reports" });
  }
};

export const previewReport = async (req, res) => {
  try {
    const report = await SeoReport.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    if (report.content) {
      return res.json({ success: true, data: { title: report.title, content: report.content } });
    }
    const filePath = resolveReportPath(report);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "Report file unavailable in this environment" });
    }
    const content = fs.readFileSync(filePath, "utf8");
    return res.json({ success: true, data: { title: report.title, content } });
  } catch (error) {
    console.error("Error previewing SEO report:", error);
    return res.status(500).json({ success: false, message: "Error previewing SEO report" });
  }
};

export const downloadReport = async (req, res) => {
  try {
    const report = await SeoReport.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    if (report.content) {
      res.setHeader("Content-Disposition", `attachment; filename="${report.file || `${report.title}.md`}"`);
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      return res.send(report.content);
    }
    const filePath = resolveReportPath(report);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "Report file unavailable in this environment" });
    }
    return res.download(filePath, report.file);
  } catch (error) {
    console.error("Error downloading SEO report:", error);
    return res.status(500).json({ success: false, message: "Error downloading SEO report" });
  }
};

// Extracts "| Key | Value |" markdown table *data* rows out of a generated
// report's content (the same shape generateMonthlyReport() writes) —
// excludes both the "|---|---|" separator line and the header row itself
// (detected by lookahead: whichever row is immediately followed by a
// separator line is the header), since callers build their own CSV header.
export const extractTableRows = (content) => {
  const lines = (content || "").split("\n");
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (!match) continue;
    if (/^-+$/.test(match[1])) continue; // the separator row itself
    const nextLine = (lines[i + 1] || "").trim();
    if (/^\|\s*-+\s*\|\s*-+\s*\|$/.test(nextLine)) continue; // header row, next line is the separator
    rows.push([match[1], match[2]]);
  }
  return rows;
};

export const downloadReportPdf = async (req, res) => {
  try {
    const report = await SeoReport.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    if (!report.content) {
      return res.status(404).json({ success: false, message: "PDF export requires a report with generated content" });
    }

    res.setHeader("Content-Disposition", `attachment; filename="${(report.file || report.title || "report").replace(/\.md$/, "")}.pdf"`);
    res.setHeader("Content-Type", "application/pdf");

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);
    doc.fontSize(18).text(report.title, { underline: true });
    doc.moveDown();
    doc.fontSize(10);
    for (const line of report.content.split("\n")) {
      if (!line.trim()) {
        doc.moveDown(0.5);
        continue;
      }
      if (line.startsWith("# ")) {
        doc.fontSize(16).text(line.replace(/^#\s*/, ""));
        doc.fontSize(10);
      } else if (line.startsWith("## ")) {
        doc.fontSize(13).text(line.replace(/^##\s*/, ""));
        doc.fontSize(10);
      } else if (line.startsWith("- ")) {
        doc.text(`•  ${line.slice(2)}`);
      } else if (!/^\|?-+\|?-*$/.test(line)) {
        doc.text(line.replace(/\|/g, "  ").trim());
      }
    }
    doc.end();
  } catch (error) {
    console.error("Error generating SEO report PDF:", error);
    // Headers/body may already be streaming by the time an error surfaces
    // here (doc.pipe(res) writes incrementally) — sending a JSON error after
    // that would throw ERR_HTTP_HEADERS_SENT and crash the request.
    if (res.headersSent) return res.end();
    return res.status(500).json({ success: false, message: "Error generating PDF" });
  }
};

export const downloadReportCsv = async (req, res) => {
  try {
    const report = await SeoReport.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    if (!report.content) {
      return res.status(404).json({ success: false, message: "CSV export requires a report with generated content" });
    }

    const rows = extractTableRows(report.content);
    const csv = ["Metric,Value", ...rows.map(([k, v]) => `"${k.replace(/"/g, '""')}","${v.replace(/"/g, '""')}"`)].join("\n");

    res.setHeader("Content-Disposition", `attachment; filename="${(report.file || report.title || "report").replace(/\.md$/, "")}.csv"`);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    return res.send(csv);
  } catch (error) {
    console.error("Error generating SEO report CSV:", error);
    return res.status(500).json({ success: false, message: "Error generating CSV" });
  }
};
