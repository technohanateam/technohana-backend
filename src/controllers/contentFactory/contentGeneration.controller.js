import ContentOpportunity from "../../models/contentOpportunity.model.js";
import ContentGenerationJob from "../../models/contentGenerationJob.model.js";
import { enqueueGeneration, enqueueRetry } from "../../services/contentFactory/contentGenerationQueue.js";
import { resumeStep } from "../../services/contentFactory/contentGenerationOrchestrator.service.js";

const GENERATABLE_STATUSES = ["PLANNED", "SELECTED", "NEEDS_REVISION"];

// POST /admin/content-factory/opportunities/:id/generate
// Enqueues the generation pipeline and returns immediately — the frontend
// polls GET /jobs/:id for progress.
export const generateOpportunityArticle = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.id);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    if (!GENERATABLE_STATUSES.includes(opportunity.status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot generate from status ${opportunity.status}. Must be PLANNED, SELECTED, or NEEDS_REVISION.`,
      });
    }

    const job = await ContentGenerationJob.create({ opportunityId: opportunity._id, status: "QUEUED" });
    await enqueueGeneration(opportunity._id.toString(), job._id.toString());

    return res.json({ success: true, data: { jobId: job._id }, message: "Generation queued" });
  } catch (err) {
    console.error("[ContentFactory] generateOpportunityArticle error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /admin/content-factory/jobs/:id
export const getGenerationJob = async (req, res) => {
  try {
    const job = await ContentGenerationJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    return res.json({ success: true, data: job });
  } catch (err) {
    console.error("[ContentFactory] getGenerationJob error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/jobs/:id/retry
export const retryGenerationJob = async (req, res) => {
  try {
    const job = await ContentGenerationJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (["QUEUED", "RUNNING"].includes(job.status)) {
      return res.status(409).json({ success: false, message: `Cannot retry — job is already ${job.status}.` });
    }

    const failedStep = req.body?.step || job.steps.find((s) => s.status === "FAILED")?.name;
    if (!failedStep) return res.status(400).json({ success: false, message: "No failed step to retry" });

    await enqueueRetry(job._id.toString(), failedStep);
    return res.json({ success: true, data: { jobId: job._id, step: failedStep }, message: "Retry queued" });
  } catch (err) {
    console.error("[ContentFactory] retryGenerationJob error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/jobs/:id/submit-step
// Manual Claude Pro workflow: the admin has copied job.pendingPrompts into
// Claude Pro chat and is pasting the response(s) back to resume the paused
// pipeline step. body: { responses: [{ label, text }] } — one entry per
// job.pendingPrompts, same order. Which kind of pause this was (initial
// quality-gate checks vs. a revision rewrite) is tracked server-side via
// job.pendingKind, not passed by the client.
export const submitStepResponse = async (req, res) => {
  try {
    const job = await ContentGenerationJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (job.status !== "AWAITING_INPUT") {
      return res.status(409).json({ success: false, message: `Job is not awaiting input (status: ${job.status})` });
    }

    const { responses } = req.body || {};
    const result = await resumeStep(job._id.toString(), { responses });

    if (!result.success && !result.awaitingInput) {
      return res.status(400).json({ success: false, message: result.error || "Failed to resume step" });
    }

    return res.json({ success: true, data: { job: result.job, opportunity: result.opportunity }, message: result.awaitingInput ? "Awaiting next input" : "Step resumed" });
  } catch (err) {
    console.error("[ContentFactory] submitStepResponse error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
