import fs from "fs";
import path from "path";
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
