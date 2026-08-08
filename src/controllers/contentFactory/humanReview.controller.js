import ContentOpportunity from "../../models/contentOpportunity.model.js";
import ContentBrief from "../../models/contentBrief.model.js";
import ContentGenerationJob from "../../models/contentGenerationJob.model.js";
import { Blogs } from "../../models/blogs.model.js";
import { createBlogFromPayload } from "../../services/blogCreation.service.js";
import { enqueueGeneration } from "../../services/contentFactory/contentGenerationQueue.js";

// GET /admin/content-factory/review/:opportunityId
// No real AI-quality scores exist yet in M2 (that's M3) — those fields are
// returned null/empty so the frontend can render placeholders gracefully.
export const getReviewItem = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.opportunityId).lean();
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const [brief, job] = await Promise.all([
      ContentBrief.findOne({ opportunityId: opportunity._id }).lean(),
      ContentGenerationJob.findOne({ opportunityId: opportunity._id }).sort({ createdAt: -1 }).lean(),
    ]);

    return res.json({
      success: true,
      data: {
        opportunity,
        brief: brief || null,
        job: job || null,
        qualityScore: null, // placeholder — lands in Milestone 3
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

// POST /admin/content-factory/review/:opportunityId/regenerate
export const regenerateReview = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    opportunity.status = "SELECTED";
    opportunity.generationAttempts = (opportunity.generationAttempts || 0) + 1;
    await opportunity.save();

    const job = await ContentGenerationJob.create({ opportunityId: opportunity._id, status: "QUEUED" });
    await enqueueGeneration(opportunity._id.toString());

    return res.json({ success: true, data: { jobId: job._id }, message: "Regeneration queued" });
  } catch (err) {
    console.error("[ContentFactory] regenerateReview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/review/:opportunityId/request-revision
// M2 stub: records the human note and re-queues the full pipeline. The real
// Revision Agent (targeted AI rewrite of flagged sections) is Milestone 3's
// job, not implemented here.
export const requestRevision = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    opportunity.status = "NEEDS_REVISION";
    opportunity.humanRevisionNote = req.body?.note || null;
    await opportunity.save();

    const job = await ContentGenerationJob.create({ opportunityId: opportunity._id, status: "QUEUED" });
    await enqueueGeneration(opportunity._id.toString());

    return res.json({ success: true, data: { jobId: job._id }, message: "Revision requested and regeneration queued" });
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

// POST /admin/content-factory/review/:opportunityId/approve
// Optional `scheduledAt` in the body also schedules the new draft (single
// endpoint handles both "Approve" and "Approve & Schedule" — chosen over a
// second dedicated route to keep the review action surface small; the
// frontend's "Approve & Schedule" button just includes scheduledAt).
export const approveReviewItem = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    // AI_REVIEW accepted too since M3's quality-gate distinction doesn't
    // fully exist yet — HUMAN_REVIEW is the primary expected M2 state.
    if (!["HUMAN_REVIEW", "AI_REVIEW"].includes(opportunity.status)) {
      return res.status(409).json({ success: false, message: `Cannot approve from status ${opportunity.status}` });
    }

    const draft = opportunity.articleDraft?.toObject ? opportunity.articleDraft.toObject() : opportunity.articleDraft;
    if (!draft?.title || !draft?.content) {
      return res.status(400).json({ success: false, message: "Article draft is missing a title or content." });
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

    blog.published = false;
    const scheduledAt = req.body?.scheduledAt;
    if (scheduledAt) blog.scheduledAt = new Date(scheduledAt);
    await blog.save();

    opportunity.status = scheduledAt ? "SCHEDULED" : "APPROVED";
    opportunity.resultingBlogId = blog._id;
    opportunity.reviewedBy = req.admin?.name || req.admin?.email || req.admin?.uid || null;
    opportunity.reviewedAt = new Date();
    await opportunity.save();

    return res.json({ success: true, data: { blogId: blog._id }, message: "Approved — draft created in Blogs" });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error("[ContentFactory] approveReviewItem error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
