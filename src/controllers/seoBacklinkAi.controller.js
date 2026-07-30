import { backlinkDiscoveryQueue } from "../services/backlinkQueue.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

export const runDiscovery = async (req, res) => {
  try {
    const { categories } = req.body || {};
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ success: false, message: "categories must be a non-empty array" });
    }
    const job = await backlinkDiscoveryQueue.add({ categories, triggeredBy: req.admin?.email || "admin" });
    await logSeoAudit(req, "discovery.queued", "SeoOpportunity", null, { categories });
    return res.json({ success: true, message: "Discovery queued", data: { queued: true, jobId: job.id } });
  } catch (error) {
    console.error("Error queuing SEO backlink discovery:", error);
    return res.status(500).json({ success: false, message: "Error queuing discovery" });
  }
};

export const getDiscoveryStatus = async (req, res) => {
  try {
    const job = await backlinkDiscoveryQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    const state = await job.getState();
    return res.json({ success: true, data: { state, result: job.returnvalue || null, failedReason: job.failedReason || null } });
  } catch (error) {
    console.error("Error fetching discovery job status:", error);
    return res.status(500).json({ success: false, message: "Error fetching job status" });
  }
};
