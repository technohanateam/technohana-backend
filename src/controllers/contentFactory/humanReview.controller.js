import ContentOpportunity from "../../models/contentOpportunity.model.js";
import ContentBrief from "../../models/contentBrief.model.js";
import ContentGenerationJob from "../../models/contentGenerationJob.model.js";
import ContentQualityScore from "../../models/contentQualityScore.model.js";
import { Blogs } from "../../models/blogs.model.js";
import SocialPost from "../../models/socialFactory/socialPost.model.js";
import { createBlogFromPayload } from "../../services/blogCreation.service.js";
import { enqueueGeneration } from "../../services/contentFactory/contentGenerationQueue.js";
import { buildRevisionPrompt, parseRevisionResponse } from "../../services/contentFactory/revisionAgent.service.js";
import { buildSocialPrompt, SOCIAL_PLATFORMS } from "../../services/socialFactory/socialPromptBuilder.service.js";

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
    const statuses = ["GENERATING", "AWAITING_INPUT", "AI_REVIEW", "HUMAN_REVIEW", "NEEDS_REVISION", "FAILED"];
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
// (APPROVED/SCHEDULED/REJECTED), which have their own workflows.
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
// Manual Claude Pro workflow — builds the revision prompt (human note merged
// alongside any existing quality-gate flag reasons) for the admin to copy
// into Claude Pro chat; does NOT apply anything yet. This is a
// human-requested revision, NOT the automatic pipeline pass, so it is NOT
// limited by opportunity.autoRevisionCount — a human can ask again as many
// times as needed. Submit the pasted response via
// POST .../request-revision/submit.
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

    const { system, prompt } = buildRevisionPrompt({ articleDraft: draft, qualityScoreResult, brief, humanNote: note, stronger: false });

    return res.json({
      success: true,
      data: { prompt: { label: "Requested revision", system, prompt } },
      message: "Copy this prompt into Claude Pro, then submit the response.",
    });
  } catch (err) {
    console.error("[ContentFactory] requestRevision error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/review/:opportunityId/request-revision/submit
// body: { text } — the admin's pasted Claude Pro response to the prompt from
// requestRevision above. Applies it (with the same too-similar sanity check
// as the automatic pipeline pass) and returns to HUMAN_REVIEW.
export const submitRevisionResponse = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.opportunityId);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    const draft = opportunity.articleDraft?.toObject ? opportunity.articleDraft.toObject() : opportunity.articleDraft;
    if (!draft?.content) {
      return res.status(400).json({ success: false, message: "No article draft to revise yet." });
    }

    const text = req.body?.text;
    if (!text) return res.status(400).json({ success: false, message: "text is required" });

    const { revised, tooSimilar } = parseRevisionResponse(text, draft);

    opportunity.articleDraft = revised;
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
    console.error("[ContentFactory] submitRevisionResponse error:", err);
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

async function createSocialPostFromSource({ sourceType, source, sourceId, platform }) {
  const generatedPrompt = buildSocialPrompt({ sourceType, source, platform });
  return SocialPost.create({
    sourceType,
    sourceId,
    sourceSlug: sourceType === "BLOG" ? source.slug || null : null,
    sourceTitle: source.title,
    platform,
    status: "AWAITING_PASTE",
    generatedPrompt,
  });
}

// Shared approval logic — used by both the single approve endpoint and
// bulk-approve, so there is exactly one place that creates a Blogs draft
// and/or SocialPost from an opportunity.
//
// outputMode: "BLOG" (default, original behavior) | "SOCIAL_ONLY" | "BOTH".
// SOCIAL_ONLY skips blog creation entirely and generates a SocialPost prompt
// straight from the opportunity (sourceType: "OPPORTUNITY") — for a trend
// that only warrants a quick platform post, not a full article. BOTH creates
// the blog first (identical to the BLOG path), then generates a SocialPost
// from that new blog (sourceType: "BLOG") — the normal, already-working path,
// reused rather than re-deriving a brief from the opportunity a second way.
//
// With no scheduledAt, the blog draft lands `published:false` same as any
// manually created draft. With a scheduledAt, it matches the existing
// auto-schedule convention (admin.routes.js `POST /blogs/auto-schedule`) of
// `published:true` + a future `scheduledAt` — the public blog routes
// (blog.controller.js) gate visibility on `published:true AND scheduledAt
// null-or-past`, so `published:false` with a scheduledAt would silently never
// go live.
async function approveOpportunityCore(opportunity, { scheduledAt, reviewerName, outputMode = "BLOG", platform = "LINKEDIN" }) {
  if (outputMode === "SOCIAL_ONLY") {
    if (!SOCIAL_PLATFORMS.includes(platform)) {
      return { ok: false, statusCode: 400, message: `platform must be one of ${SOCIAL_PLATFORMS.join(", ")}` };
    }
    const post = await createSocialPostFromSource({ sourceType: "OPPORTUNITY", source: opportunity, sourceId: opportunity._id, platform });

    opportunity.status = "APPROVED";
    opportunity.resultingSocialPostId = post._id;
    opportunity.reviewedBy = reviewerName || null;
    opportunity.reviewedAt = new Date();
    await opportunity.save();

    return { ok: true, socialPostId: post._id };
  }

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

  let socialPostId = null;
  if (outputMode === "BOTH") {
    if (!SOCIAL_PLATFORMS.includes(platform)) {
      return { ok: false, statusCode: 400, message: `platform must be one of ${SOCIAL_PLATFORMS.join(", ")}` };
    }
    const post = await createSocialPostFromSource({ sourceType: "BLOG", source: blog, sourceId: blog._id, platform });
    socialPostId = post._id;
  }

  opportunity.status = scheduledAt ? "SCHEDULED" : "APPROVED";
  opportunity.resultingBlogId = blog._id;
  opportunity.resultingSocialPostId = socialPostId;
  opportunity.reviewedBy = reviewerName || null;
  opportunity.reviewedAt = new Date();
  await opportunity.save();

  // slug is the authoritative, collision-resolved value (uniqueSlug may have
  // suffixed it) — surface it so the frontend can build a "View Blog" link to
  // /blog/:slug without re-deriving (and possibly mismatching) it.
  return { ok: true, blogId: blog._id, slug: blog.slug, socialPostId };
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
    const outputMode = ["BLOG", "SOCIAL_ONLY", "BOTH"].includes(req.body?.outputMode) ? req.body.outputMode : "BLOG";
    const result = await approveOpportunityCore(opportunity, {
      scheduledAt: req.body?.scheduledAt,
      reviewerName,
      outputMode,
      platform: req.body?.platform,
    });
    if (!result.ok) return res.status(result.statusCode).json({ success: false, message: result.message });

    const message =
      outputMode === "SOCIAL_ONLY"
        ? "Approved — social post prompt generated"
        : outputMode === "BOTH"
        ? "Approved — draft created in Blogs and social post prompt generated"
        : "Approved — draft created in Blogs";
    return res.json({
      success: true,
      data: { blogId: result.blogId || null, slug: result.slug || null, socialPostId: result.socialPostId || null },
      message,
    });
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
        if (result.ok) approved.push({ id, blogId: result.blogId, slug: result.slug });
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
