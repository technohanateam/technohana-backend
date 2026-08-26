import AdCreativeOpportunity from "../../models/adCreativeFactory/adCreativeOpportunity.model.js";
import AdCreativeGenerationJob from "../../models/adCreativeFactory/adCreativeGenerationJob.model.js";
import { enqueueGeneration } from "../../services/adCreativeFactory/adCreativeFactoryQueue.js";
import { buildRevisionPrompt, parseRevisionResponse } from "../../services/adCreativeFactory/adCreativeRevisionAgent.service.js";

// GET /admin/ad-creative-factory/review/:opportunityId
export const getReviewItem = async (req, res) => {
  try {
    const opportunity = await AdCreativeOpportunity.findById(req.params.opportunityId).lean();
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const job = await AdCreativeGenerationJob.findOne({ opportunityId: opportunity._id }).sort({ createdAt: -1 }).lean();

    return res.json({ success: true, data: { opportunity, job: job || null } });
  } catch (err) {
    console.error("[AdCreativeFactory] getReviewItem error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /admin/ad-creative-factory/review — list opportunities awaiting/in review
export const listReviewItems = async (req, res) => {
  try {
    const statuses = ["GENERATING", "AWAITING_INPUT", "HUMAN_REVIEW", "NEEDS_REVISION", "FAILED"];
    const status = req.query.status && statuses.includes(req.query.status) ? [req.query.status] : statuses;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 25);

    const [rows, total] = await Promise.all([
      AdCreativeOpportunity.find({ status: { $in: status } }).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AdCreativeOpportunity.countDocuments({ status: { $in: status } }),
    ]);

    return res.json({ success: true, data: { rows, total, page, limit } });
  } catch (err) {
    console.error("[AdCreativeFactory] listReviewItems error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const DRAFT_EDITABLE_ARRAYS = ["headlines", "primaryTexts", "descriptions", "ctas"];

// PATCH /admin/ad-creative-factory/review/:opportunityId — edit creativeDraft variants
export const updateReviewDraft = async (req, res) => {
  try {
    const opportunity = await AdCreativeOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const updates = req.body?.creativeDraft || {};
    const current = opportunity.creativeDraft?.toObject ? opportunity.creativeDraft.toObject() : opportunity.creativeDraft || {};
    const merged = { ...current };
    for (const field of DRAFT_EDITABLE_ARRAYS) {
      if (Array.isArray(updates[field])) merged[field] = updates[field];
    }
    opportunity.creativeDraft = merged;
    await opportunity.save();

    return res.json({ success: true, data: opportunity, message: "Draft updated" });
  } catch (err) {
    console.error("[AdCreativeFactory] updateReviewDraft error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Mirrors GENERATABLE_STATUSES for "not yet generated"; excludes GENERATING
// (job already in flight) and terminal states (APPROVED/REJECTED).
const REGENERATABLE_STATUSES = ["HUMAN_REVIEW", "NEEDS_REVISION", "FAILED"];

// POST /admin/ad-creative-factory/review/:opportunityId/regenerate
export const regenerateReview = async (req, res) => {
  try {
    const opportunity = await AdCreativeOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    if (!REGENERATABLE_STATUSES.includes(opportunity.status)) {
      return res.status(409).json({ success: false, message: `Cannot regenerate from status ${opportunity.status}.` });
    }

    opportunity.status = "SELECTED";
    opportunity.generationAttempts = (opportunity.generationAttempts || 0) + 1;
    await opportunity.save();

    const job = await AdCreativeGenerationJob.create({ opportunityId: opportunity._id, status: "QUEUED" });
    await enqueueGeneration(opportunity._id.toString(), job._id.toString());

    return res.json({ success: true, data: { jobId: job._id }, message: "Regeneration queued" });
  } catch (err) {
    console.error("[AdCreativeFactory] regenerateReview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/ad-creative-factory/review/:opportunityId/request-revision
// Manual Claude Pro workflow — builds the revision prompt for the admin to
// copy into Claude Pro chat; does NOT apply anything yet. Human-requested, so
// NOT limited by opportunity.autoRevisionCount. Submit via .../submit.
export const requestRevision = async (req, res) => {
  try {
    const opportunity = await AdCreativeOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const draft = opportunity.creativeDraft?.toObject ? opportunity.creativeDraft.toObject() : opportunity.creativeDraft;
    if (!draft?.headlines?.length) {
      return res.status(400).json({ success: false, message: "No creative draft to revise yet." });
    }

    const note = req.body?.note || null;
    opportunity.humanRevisionNote = note;
    await opportunity.save();

    const { system, prompt } = buildRevisionPrompt({ creativeDraft: draft, flagReasons: opportunity.complianceFlags, humanNote: note, stronger: false });

    return res.json({
      success: true,
      data: { prompt: { label: "Requested revision", system, prompt } },
      message: "Copy this prompt into Claude Pro, then submit the response.",
    });
  } catch (err) {
    console.error("[AdCreativeFactory] requestRevision error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/ad-creative-factory/review/:opportunityId/request-revision/submit
// body: { text }
export const submitRevisionResponse = async (req, res) => {
  try {
    const opportunity = await AdCreativeOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const draft = opportunity.creativeDraft?.toObject ? opportunity.creativeDraft.toObject() : opportunity.creativeDraft;
    if (!draft?.headlines?.length) {
      return res.status(400).json({ success: false, message: "No creative draft to revise yet." });
    }

    const text = req.body?.text;
    if (!text) return res.status(400).json({ success: false, message: "text is required" });

    const fallbackPlatform = opportunity.platform === "BOTH" ? "META" : opportunity.platform;
    const { revised, tooSimilar } = parseRevisionResponse(text, draft, fallbackPlatform);

    opportunity.creativeDraft = revised;
    opportunity.status = "HUMAN_REVIEW";
    await opportunity.save();

    return res.json({
      success: true,
      data: { opportunity, tooSimilar },
      message: tooSimilar
        ? "Revision applied, but it reads very close to the original — consider asking Claude Pro for a stronger rewrite and resubmitting."
        : "Revision applied — back in human review",
    });
  } catch (err) {
    console.error("[AdCreativeFactory] submitRevisionResponse error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/ad-creative-factory/review/:opportunityId/reject
export const rejectReviewItem = async (req, res) => {
  try {
    const opportunity = await AdCreativeOpportunity.findByIdAndUpdate(
      req.params.opportunityId,
      {
        $set: {
          status: "REJECTED",
          rejectionReason: req.body?.rejectionReason || null,
          reviewedBy: req.admin?.name || req.admin?.email || req.admin?.uid || null,
          reviewedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });
    return res.json({ success: true, data: opportunity, message: "Opportunity rejected" });
  } catch (err) {
    console.error("[AdCreativeFactory] rejectReviewItem error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Server-side re-validation that an opportunity is actually safe to approve.
function assertApprovable(opportunity) {
  if (!opportunity) return { approvable: false, reason: "Opportunity not found" };
  if (opportunity.status !== "HUMAN_REVIEW") {
    return { approvable: false, reason: `Cannot approve from status ${opportunity.status}` };
  }
  return { approvable: true };
}

// Shared approval logic — no downstream doc is created (unlike Content
// Factory's approve, which creates a Blogs draft). Approving here just
// flips status to APPROVED, "ready to run" — an admin then hands the
// creative off manually to run it live via Meta/LinkedIn ads manager.
function approveOpportunityCore(opportunity, { reviewerName }) {
  opportunity.status = "APPROVED";
  opportunity.reviewedBy = reviewerName || null;
  opportunity.reviewedAt = new Date();
  return opportunity.save();
}

// POST /admin/ad-creative-factory/review/:opportunityId/approve
export const approveReviewItem = async (req, res) => {
  try {
    const opportunity = await AdCreativeOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const check = assertApprovable(opportunity);
    if (!check.approvable) return res.status(409).json({ success: false, message: check.reason });

    const reviewerName = req.admin?.name || req.admin?.email || req.admin?.uid || null;
    await approveOpportunityCore(opportunity, { reviewerName });

    return res.json({ success: true, data: opportunity, message: "Approved — ready to run" });
  } catch (err) {
    console.error("[AdCreativeFactory] approveReviewItem error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/ad-creative-factory/review/bulk-approve — { ids: [...] }
export const bulkApproveReview = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ success: false, message: "ids array is required" });

    const reviewerName = req.admin?.name || req.admin?.email || req.admin?.uid || null;
    const approved = [];
    const skipped = [];

    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const opportunity = await AdCreativeOpportunity.findById(id);
      const check = assertApprovable(opportunity);
      if (!check.approvable) {
        skipped.push({ id, reason: check.reason });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await approveOpportunityCore(opportunity, { reviewerName });
        approved.push({ id });
      } catch (err) {
        skipped.push({ id, reason: err.message });
      }
    }

    return res.json({
      success: true,
      data: { approved, skipped },
      message: `Approved ${approved.length} of ${ids.length}${skipped.length ? `; skipped ${skipped.length}` : ""}`,
    });
  } catch (err) {
    console.error("[AdCreativeFactory] bulkApproveReview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/ad-creative-factory/review/bulk-reject — { ids: [...], rejectionReason }
export const bulkRejectReview = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ success: false, message: "ids array is required" });

    const reviewerName = req.admin?.name || req.admin?.email || req.admin?.uid || null;
    const result = await AdCreativeOpportunity.updateMany(
      { _id: { $in: ids } },
      { $set: { status: "REJECTED", rejectionReason: req.body?.rejectionReason || null, reviewedBy: reviewerName, reviewedAt: new Date() } }
    );

    return res.json({
      success: true,
      data: { matched: result.matchedCount ?? result.n, modified: result.modifiedCount ?? result.nModified },
      message: `Rejected ${result.modifiedCount ?? result.nModified ?? 0} opportunit${(result.modifiedCount ?? result.nModified) === 1 ? "y" : "ies"}`,
    });
  } catch (err) {
    console.error("[AdCreativeFactory] bulkRejectReview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/ad-creative-factory/review/bulk-regenerate — { ids: [...] }
export const bulkRegenerateReview = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ success: false, message: "ids array is required" });

    const queued = [];
    const skipped = [];

    for (const id of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const opportunity = await AdCreativeOpportunity.findById(id);
        if (!opportunity) {
          skipped.push({ id, reason: "Opportunity not found" });
          continue;
        }
        if (!REGENERATABLE_STATUSES.includes(opportunity.status)) {
          skipped.push({ id, reason: `Cannot regenerate from status ${opportunity.status}` });
          continue;
        }
        opportunity.status = "SELECTED";
        opportunity.generationAttempts = (opportunity.generationAttempts || 0) + 1;
        // eslint-disable-next-line no-await-in-loop
        await opportunity.save();

        // eslint-disable-next-line no-await-in-loop
        const job = await AdCreativeGenerationJob.create({ opportunityId: opportunity._id, status: "QUEUED" });
        // eslint-disable-next-line no-await-in-loop
        await enqueueGeneration(opportunity._id.toString(), job._id.toString());
        queued.push({ id, jobId: job._id });
      } catch (err) {
        skipped.push({ id, reason: err.message });
      }
    }

    return res.json({
      success: true,
      data: { queued, skipped },
      message: `Regeneration queued for ${queued.length} of ${ids.length}`,
    });
  } catch (err) {
    console.error("[AdCreativeFactory] bulkRegenerateReview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
