import { backlinkVerificationQueue } from "../services/backlinkQueue.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

export const runVerification = async (req, res) => {
  try {
    const { ids } = req.body || {};
    const job = await backlinkVerificationQueue.add({ ids });
    await logSeoAudit(req, "monitoring.verification_queued", "SeoMonitoring", null, { ids: ids?.length || "all-stale" });
    return res.json({ success: true, message: "Verification queued", data: { queued: true, jobId: job.id } });
  } catch (error) {
    console.error("Error queuing SEO backlink verification:", error);
    return res.status(500).json({ success: false, message: "Error queuing verification" });
  }
};

export const getVerificationStatus = async (req, res) => {
  try {
    const job = await backlinkVerificationQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    const state = await job.getState();
    return res.json({ success: true, data: { state, result: job.returnvalue || null, failedReason: job.failedReason || null } });
  } catch (error) {
    console.error("Error fetching verification job status:", error);
    return res.status(500).json({ success: false, message: "Error fetching job status" });
  }
};
