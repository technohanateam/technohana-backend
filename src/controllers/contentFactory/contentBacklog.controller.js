import { getBacklogWithRecommendations } from "../../services/contentFactory/contentBacklog.service.js";

export const getBacklogHandler = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const data = await getBacklogWithRecommendations({ page, limit });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[ContentFactory] getBacklog error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
