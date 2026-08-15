import SeoCrawlRun from "../models/seoCrawlRun.model.js";
import SeoCrawlPage from "../models/seoCrawlPage.model.js";
import { crawlQueue, SINGLE_RUN_RETRY_CONFIG } from "../services/seoIntelQueue.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

export const listCrawlRuns = async (req, res) => {
  try {
    const runs = await SeoCrawlRun.find().sort({ startedAt: -1 }).limit(50).lean();
    return res.json({ success: true, data: runs });
  } catch (error) {
    console.error("Error listing crawl runs:", error);
    return res.status(500).json({ success: false, message: "Error listing crawl runs" });
  }
};

export const getCrawlRun = async (req, res) => {
  try {
    const run = await SeoCrawlRun.findById(req.params.id).lean();
    if (!run) return res.status(404).json({ success: false, message: "Crawl run not found" });
    return res.json({ success: true, data: run });
  } catch (error) {
    console.error("Error fetching crawl run:", error);
    return res.status(500).json({ success: false, message: "Error fetching crawl run" });
  }
};

export const getCrawlRunPages = async (req, res) => {
  try {
    const { id } = req.params;
    const { issue } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const query = { crawlRunId: id };
    if (issue) query.issues = issue;

    const pages = await SeoCrawlPage.find(query)
      .sort({ url: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const total = await SeoCrawlPage.countDocuments(query);

    return res.json({ success: true, data: pages, meta: { total, page, limit } });
  } catch (error) {
    console.error("Error fetching crawl pages:", error);
    return res.status(500).json({ success: false, message: "Error fetching crawl pages" });
  }
};

export const triggerCrawl = async (req, res) => {
  try {
    await crawlQueue.add({ triggeredBy: "manual" }, SINGLE_RUN_RETRY_CONFIG);
    await logSeoAudit(req, "crawl.trigger", "SeoCrawlRun", null, {});
    return res.json({ success: true, message: "Crawl queued" });
  } catch (error) {
    console.error("Error triggering crawl:", error);
    return res.status(500).json({ success: false, message: "Error triggering crawl" });
  }
};
