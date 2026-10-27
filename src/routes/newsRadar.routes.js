import express from "express";
import { authenticateAdmin, requireMarketing, requirePage } from "../middleware/authenticateAdmin.js";
import NewsItem from "../models/newsItem.model.js";
import { SOCIAL_PLATFORMS } from "../services/socialFactory/socialPromptBuilder.service.js";
import { createSocialPostForSource } from "../services/socialFactory/socialPostCreation.service.js";
import { enqueueNewsRadarRunNow } from "../services/newsRadarQueue.js";

const router = express.Router();

// News Radar lives inside the Social Factory section, so it reuses that page key.
router.use(authenticateAdmin, requirePage("social-factory"), requireMarketing);

const STATUSES = ["NEW", "SHORTLISTED", "DRAFTED", "DISMISSED"];

// GET /admin/news-radar/items?status=NEW&page=1
router.get("/items", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 30);
    const query = { status: STATUSES.includes(req.query.status) ? req.query.status : { $ne: "DISMISSED" } };
    if (["ARTICLE", "VIDEO"].includes(req.query.kind)) query.kind = req.query.kind;
    const [rows, total] = await Promise.all([
      NewsItem.find(query)
        .sort({ breaking: -1, aiScore: -1, heuristicScore: -1, publishedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      NewsItem.countDocuments(query),
    ]);
    return res.json({ success: true, data: { rows, total, page, limit } });
  } catch (err) {
    console.error("[NewsRadar] list error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /admin/news-radar/items/:id  { status: "SHORTLISTED" | "DISMISSED" | "NEW" }
router.patch("/items/:id", async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!["NEW", "SHORTLISTED", "DISMISSED"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be NEW, SHORTLISTED or DISMISSED" });
    }
    const item = await NewsItem.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean();
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    return res.json({ success: true, data: item });
  } catch (err) {
    console.error("[NewsRadar] update error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /admin/news-radar/items/:id/draft  { platform }
router.post("/items/:id/draft", async (req, res) => {
  try {
    const { platform } = req.body || {};
    if (!SOCIAL_PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: `platform must be one of ${SOCIAL_PLATFORMS.join(", ")}` });
    }
    const item = await NewsItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });

    const post = await createSocialPostForSource({ sourceType: "NEWS", sourceId: item._id, source: item.toObject(), platform });
    item.socialPostIds.push(post._id);
    item.status = "DRAFTED";
    await item.save();
    return res.status(201).json({ success: true, data: post });
  } catch (err) {
    console.error("[NewsRadar] draft error:", err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : "Server error" });
  }
});

// POST /admin/news-radar/refresh
router.post("/refresh", async (req, res) => {
  try {
    await enqueueNewsRadarRunNow();
    return res.json({ success: true, message: "Refresh queued" });
  } catch (err) {
    console.error("[NewsRadar] refresh error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
