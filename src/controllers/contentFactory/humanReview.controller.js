import ContentOpportunity from "../../models/contentOpportunity.model.js";
import ContentBrief from "../../models/contentBrief.model.js";
import ContentGenerationJob from "../../models/contentGenerationJob.model.js";
import ContentQualityScore from "../../models/contentQualityScore.model.js";
import { Blogs } from "../../models/blogs.model.js";
import { createBlogFromPayload } from "../../services/blogCreation.service.js";
import { enqueueGeneration } from "../../services/contentFactory/contentGenerationQueue.js";
import { reviseArticle } from "../../services/contentFactory/revisionAgent.service.js";

// GET /admin/content-factory/review/:opportunityId
// M3: includes the latest ContentQualityScore plus full attempt history
// (rather than a second dedicated endpoint) so the frontend's AI Quality tab
// and revision-history indicator have everything in one response.
export const getReviewItem = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.opportunityId).lean();
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const [brief, job, qualityScoreHistory] = await Promise.all([
      ContentBrief.findOne({ opportunityId: opportunity._id }).lean(),
      ContentGenerationJob.findOne({ opportunityId: opportunity._id }).sort({ createdAt: -1 }).lean(),
      ContentQualityScore.find({ opportunityId: opportunity._id }).sort({ generationAttempt: 1, createdAt: 1 }).lean(),
    ]);

    return res.json({
      success: true,
      data: {
        opportunity,
        brief: brief || null,
        job: job || null,
        qualityScore: qualityScoreHistory.length ? qualityScoreHistory[qualityScoreHistory.length - 1] : null,
        qualityScoreHistory,
      },
    });
  } catch (err) {
    console.error("[ContentFactory] getReviewItem error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /admin/content-factory/review — list opportunities awaiting/in review
export const listReviewItems = async (req, res) => {
  try {
    const statuses = ["GENERATING", "AI_REVIEW", "HUMAN_REVIEW", "NEEDS_REVISION", "FAILED"];
    const status = req.query.status && statuses.includes(req.query.status) ? [req.query.status] : statuses;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 25);

    const [rows, total] = await Promise.all([
      ContentOpportunity.find({ status: { $in: status } })
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ContentOpportunity.countDocuments({ status: { $in: status } }),
    ]);

    return res.json({ success: true, data: { rows, total, page, limit } });
  } catch (err) {
    console.error("[ContentFactory] listReviewItems error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const ARTICLE_DRAFT_EDITABLE_FIELDS = [
  "title", "slug", "content", "excerpt", "metaTitle", "metaDescription",
  "tags", "readTimeMin", "sources", "faqs", "suggestedInternalLinks",
  "focusKeyword", "author", "category",
];

// PATCH /admin/content-factory/review/:opportunityId — edit articleDraft fields
export const updateReviewDraft = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const updates = req.body?.articleDraft || {};
    const current = opportunity.articleDraft?.toObject ? opportunity.articleDraft.toObject() : opportunity.articleDraft || {};
    const merged = { ...current };
    for (const field of ARTICLE_DRAFT_EDITABLE_FIELDS) {
      if (updates[field] !== undefined) merged[field] = updates[field];
    }
    opportunity.articleDraft = merged;
    await opportunity.save();

    return res.json({ success: true, data: opportunity, message: "Draft updated" });
  } catch (err) {
    console.error("[ContentFactory] updateReviewDraft error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Opportunities that already have (or are getting) a draft to reconsider —
// mirrors GENERATABLE_STATUSES in contentGeneration.controller.js, which
// covers the "not yet generated" side (PLANNED/SELECTED/NEEDS_REVISION).
// Deliberately excludes GENERATING (a job is already in flight — see the
// double-job-doc race this guards against) and terminal states
// (APPROVED/SCHEDULED/PUBLISHED/REJECTED), which have their own workflows.
const REGENERATABLE_STATUSES = ["HUMAN_REVIEW", "AI_REVIEW", "NEEDS_REVISION", "FAILED"];

// POST /admin/content-factory/review/:opportunityId/regenerate
export const regenerateReview = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    if (!REGENERATABLE_STATUSES.includes(opportunity.status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot regenerate from status ${opportunity.status}.`,
      });
    }

    opportunity.status = "SELECTED";
    opportunity.generationAttempts = (opportunity.generationAttempts || 0) + 1;
    await opportunity.save();

    const job = await ContentGenerationJob.create({ opportunityId: opportunity._id, status: "QUEUED" });
    await enqueueGeneration(opportunity._id.toString(), job._id.toString());

    return res.json({ success: true, data: { jobId: job._id }, message: "Regeneration queued" });
  } catch (err) {
    console.error("[ContentFactory] regenerateReview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/review/:opportunityId/request-revision
// M3: real Revision Agent wiring — calls revisionAgent.service.js with the
// human's note merged alongside any existing quality-gate flag reasons. This
// is a human-requested revision, NOT the automatic pipeline pass, so it is
// NOT limited by opportunity.autoRevisionCount — a human can ask again as
// many times as needed. After revision, status goes back to HUMAN_REVIEW
// (never auto-approved) so the human re-checks the result.
export const requestRevision = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const draft = opportunity.articleDraft?.toObject ? opportunity.articleDraft.toObject() : opportunity.articleDraft;
    if (!draft?.content) {
      return res.status(400).json({ success: false, message: "No article draft to revise yet." });
    }

    const note = req.body?.note || null;
    opportunity.humanRevisionNote = note;
    await opportunity.save();

    const [brief, latestScore] = await Promise.all([
      ContentBrief.findOne({ opportunityId: opportunity._id }).lean(),
      ContentQualityScore.findOne({ opportunityId: opportunity._id }).sort({ createdAt: -1 }).lean(),
    ]);

    const qualityScoreResult = {
      flagReasons: latestScore?.flagReasons || [],
      factCheckFindings: latestScore?.factCheckFindings || [],
    };

    const revisionResult = await reviseArticle(draft, qualityScoreResult, brief, { humanNote: note });

    opportunity.articleDraft = revisionResult.articleDraft;
    opportunity.status = "HUMAN_REVIEW";
    await opportunity.save();

    return res.json({
      success: true,
      data: { opportunity, gaveUp: revisionResult.gaveUp, note: revisionResult.note },
      message: revisionResult.gaveUp
        ? "Revision applied, but the automatic rewrite could not substantially change the flagged sections — please review closely."
        : "Revision applied — back in human review",
    });
  } catch (err) {
    console.error("[ContentFactory] requestRevision error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/review/:opportunityId/reject
export const rejectReviewItem = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findByIdAndUpdate(
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
    console.error("[ContentFactory] rejectReviewItem error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

async function uniqueSlug(desiredSlug) {
  if (!desiredSlug) return desiredSlug;
  let candidate = desiredSlug;
  let suffix = 2;
  // Small UX kindness rather than failing outright on a slug collision.
  // eslint-disable-next-line no-await-in-loop
  while (await Blogs.findOne({ slug: candidate }).lean()) {
    candidate = `${desiredSlug}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

// Shared approval logic — used by both the single approve endpoint and
// bulk-approve, so there is exactly one place that creates a Blogs draft
// from an opportunity. With no scheduledAt, the draft lands `published:false`
// same as any manually created draft. With a scheduledAt, it matches the
// existing auto-schedule convention (admin.routes.js `POST /blogs/auto-schedule`)
// of `published:true` + a future `scheduledAt` — the public blog routes
// (blog.controller.js) gate visibility on `published:true AND scheduledAt
// null-or-past`, so `published:false` with a scheduledAt would silently never
// go live.
async function approveOpportunityCore(opportunity, { scheduledAt, reviewerName }) {
  const draft = opportunity.articleDraft?.toObject ? opportunity.articleDraft.toObject() : opportunity.articleDraft;
  if (!draft?.title || !draft?.content) {
    return { ok: false, statusCode: 400, message: "Article draft is missing a title or content." };
  }

  const desiredSlug =
    draft.slug ||
    draft.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  const slug = await uniqueSlug(desiredSlug);

  const blog = await createBlogFromPayload({
    title: draft.title,
    slug,
    img: opportunity.imageConcept?.imageUrl || "",
    author: draft.author || "",
    date: new Date().toISOString().split("T")[0],
    content: draft.content,
    category: draft.category || opportunity.category || "",
    excerpt: draft.excerpt || "",
    metaTitle: draft.metaTitle || "",
    metaDescription: draft.metaDescription || "",
    focusKeyword: draft.focusKeyword || opportunity.focusKeyword || "",
    tags: draft.tags || [],
    readTimeMin: draft.readTimeMin || null,
    sources: draft.sources || [],
    faqs: draft.faqs || [],
    sourceOpportunityId: opportunity._id,
  });

  if (scheduledAt) {
    blog.published = true;
    blog.scheduledAt = new Date(scheduledAt);
  } else {
    blog.published = false;
  }
  await blog.save();

  opportunity.status = scheduledAt ? "SCHEDULED" : "APPROVED";
  opportunity.resultingBlogId = blog._id;
  opportunity.reviewedBy = reviewerName || null;
  opportunity.reviewedAt = new Date();
  await opportunity.save();

  return { ok: true, blogId: blog._id };
}

// Server-side re-validation that an opportunity is actually safe to approve —
// never trusts the client's selection alone. Rejects/skips anything whose
// status isn't an approvable review state, or whose latest quality score is
// still flagged for revision.
async function assertApprovable(opportunity) {
  if (!opportunity) return { approvable: false, reason: "Opportunity not found" };
  if (!["HUMAN_REVIEW", "AI_REVIEW"].includes(opportunity.status)) {
    return { approvable: false, reason: `Cannot approve from status ${opportunity.status}` };
  }
  const latestScore = await ContentQualityScore.findOne({ opportunityId: opportunity._id }).sort({ createdAt: -1 }).lean();
  if (latestScore?.flaggedForRevision) {
    return { approvable: false, reason: "Latest quality score is still flagged for revision" };
  }
  return { approvable: true };
}

// POST /admin/content-factory/review/:opportunityId/approve
// Optional `scheduledAt` in the body also schedules the new draft (single
// endpoint handles both "Approve" and "Approve & Schedule" — chosen over a
// second dedicated route to keep the review action surface small; the
// frontend's "Approve & Schedule" button just includes scheduledAt).
export const approveReviewItem = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    // AI_REVIEW accepted too since AI_REVIEW is only ever transient — most
    // opportunities reach HUMAN_REVIEW or NEEDS_REVISION via the quality gate.
    if (!["HUMAN_REVIEW", "AI_REVIEW"].includes(opportunity.status)) {
      return res.status(409).json({ success: false, message: `Cannot approve from status ${opportunity.status}` });
    }

    const reviewerName = req.admin?.name || req.admin?.email || req.admin?.uid || null;
    const result = await approveOpportunityCore(opportunity, { scheduledAt: req.body?.scheduledAt, reviewerName });
    if (!result.ok) return res.status(result.statusCode).json({ success: false, message: result.message });

    return res.json({ success: true, data: { blogId: result.blogId }, message: "Approved — draft created in Blogs" });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error("[ContentFactory] approveReviewItem error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/review/bulk-approve — { ids: [...] }
// Re-validates EVERY id server-side (status + latest quality score) — never
// trusts the client's selection alone. Anything that fails validation is
// skipped and reported back, not silently included.
export const bulkApproveReview = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ success: false, message: "ids array is required" });

    const reviewerName = req.admin?.name || req.admin?.email || req.admin?.uid || null;
    const approved = [];
    const skipped = [];

    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const opportunity = await ContentOpportunity.findById(id);
      // eslint-disable-next-line no-await-in-loop
      const check = await assertApprovable(opportunity);
      if (!check.approvable) {
        skipped.push({ id, reason: check.reason });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await approveOpportunityCore(opportunity, { scheduledAt: null, reviewerName });
        if (result.ok) approved.push({ id, blogId: result.blogId });
        else skipped.push({ id, reason: result.message });
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
    console.error("[ContentFactory] bulkApproveReview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/review/bulk-reject — { ids: [...], rejectionReason }
export const bulkRejectReview = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ success: false, message: "ids array is required" });

    const reviewerName = req.admin?.name || req.admin?.email || req.admin?.uid || null;
    const result = await ContentOpportunity.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: "REJECTED",
          rejectionReason: req.body?.rejectionReason || null,
          reviewedBy: reviewerName,
          reviewedAt: new Date(),
        },
      }
    );

    return res.json({
      success: true,
      data: { matched: result.matchedCount ?? result.n, modified: result.modifiedCount ?? result.nModified },
      message: `Rejected ${result.modifiedCount ?? result.nModified ?? 0} opportunit${(result.modifiedCount ?? result.nModified) === 1 ? "y" : "ies"}`,
    });
  } catch (err) {
    console.error("[ContentFactory] bulkRejectReview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/review/bulk-regenerate — { ids: [...] }
// Respects the same status validation as the single regenerate endpoint —
// REGENERATABLE_STATUSES, defined above.
export const bulkRegenerateReview = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ success: false, message: "ids array is required" });

    const queued = [];
    const skipped = [];

    for (const id of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const opportunity = await ContentOpportunity.findById(id);
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
        const job = await ContentGenerationJob.create({ opportunityId: opportunity._id, status: "QUEUED" });
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
    console.error("[ContentFactory] bulkRegenerateReview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
