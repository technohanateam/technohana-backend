import SeoRecommendation from "../models/seoRecommendation.model.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

export const listRecommendations = async (req, res) => {
  try {
    const { status, priority, category } = req.query;
    const query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;

    const recommendations = await SeoRecommendation.find(query).sort({ generatedAt: -1 }).limit(500).lean();
    return res.json({ success: true, data: recommendations });
  } catch (error) {
    console.error("Error listing recommendations:", error);
    return res.status(500).json({ success: false, message: "Error listing recommendations" });
  }
};

export const updateRecommendation = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["open", "in_progress", "resolved", "dismissed"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const update = { status };
    if (status === "resolved") update.resolvedAt = new Date();
    if (status === "dismissed") update.dismissedAt = new Date();

    const recommendation = await SeoRecommendation.findByIdAndUpdate(id, update, { new: true });
    if (!recommendation) return res.status(404).json({ success: false, message: "Recommendation not found" });

    await logSeoAudit(req, "recommendation.status_change", "SeoRecommendation", id, { status });
    return res.json({ success: true, data: recommendation });
  } catch (error) {
    console.error("Error updating recommendation:", error);
    return res.status(500).json({ success: false, message: "Error updating recommendation" });
  }
};
