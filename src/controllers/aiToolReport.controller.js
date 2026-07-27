import { AiToolReport, AI_TOOL_TYPES } from "../models/aiToolReport.model.js";

export const saveReport = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ success: false, message: "User not authenticated" });

    const { toolType, title, reportData } = req.body || {};
    if (!AI_TOOL_TYPES.includes(toolType)) {
      return res.status(400).json({ success: false, message: "Invalid toolType" });
    }
    if (!title?.trim() || !reportData || typeof reportData !== "object") {
      return res.status(400).json({ success: false, message: "title and reportData are required" });
    }

    const report = await AiToolReport.create({
      email: email.toLowerCase(),
      toolType,
      title: title.trim(),
      reportData,
    });

    return res.status(201).json({ success: true, data: report, message: "Report saved successfully" });
  } catch (err) {
    console.error("saveReport error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to save report" });
  }
};

export const getMyReports = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ success: false, message: "User not authenticated" });

    const filter = { email: email.toLowerCase() };
    if (req.query.toolType) {
      if (!AI_TOOL_TYPES.includes(req.query.toolType)) {
        return res.status(400).json({ success: false, message: "Invalid toolType filter" });
      }
      filter.toolType = req.query.toolType;
    }

    const reports = await AiToolReport.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: reports, message: "Reports retrieved successfully" });
  } catch (err) {
    console.error("getMyReports error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch reports" });
  }
};

export const deleteReport = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ success: false, message: "User not authenticated" });

    const report = await AiToolReport.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });

    if (report.email !== email.toLowerCase()) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this report" });
    }

    await report.deleteOne();
    return res.json({ success: true, data: null, message: "Report deleted successfully" });
  } catch (err) {
    console.error("deleteReport error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to delete report" });
  }
};
