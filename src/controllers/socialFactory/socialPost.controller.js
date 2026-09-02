import SocialPost from "../../models/socialFactory/socialPost.model.js";
import Course from "../../models/course.model.js";
import { Blogs } from "../../models/blogs.model.js";
import { buildSocialPrompt, SOCIAL_PLATFORMS } from "../../services/socialFactory/socialPromptBuilder.service.js";
import { parseSocialPostResponse } from "../../services/socialFactory/socialPostParser.service.js";

// GET /admin/social-factory/posts
export const listPosts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 25);
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.platform) query.platform = req.query.platform;
    if (req.query.sourceType) query.sourceType = req.query.sourceType;

    const [rows, total] = await Promise.all([
      SocialPost.find(query).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SocialPost.countDocuments(query),
    ]);

    return res.json({ success: true, data: { rows, total, page, limit } });
  } catch (err) {
    console.error("[SocialFactory] listPosts error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /admin/social-factory/posts/:id
export const getPost = async (req, res) => {
  try {
    const post = await SocialPost.findById(req.params.id).lean();
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    return res.json({ success: true, data: post });
  } catch (err) {
    console.error("[SocialFactory] getPost error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/social-factory/posts — picks a source Course/Blog + platform,
// builds the manual prompt, and moves straight to AWAITING_PASTE (there is no
// separate automated generation step for this factory).
export const createPost = async (req, res) => {
  try {
    const { sourceType, sourceId, platform } = req.body || {};

    if (!["COURSE", "BLOG"].includes(sourceType)) {
      return res.status(400).json({ success: false, message: "sourceType must be COURSE or BLOG" });
    }
    if (!SOCIAL_PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: `platform must be one of ${SOCIAL_PLATFORMS.join(", ")}` });
    }
    if (!sourceId) {
      return res.status(400).json({ success: false, message: "sourceId is required" });
    }

    const source =
      sourceType === "COURSE" ? await Course.findById(sourceId).lean() : await Blogs.findById(sourceId).lean();
    if (!source) {
      return res.status(404).json({ success: false, message: `${sourceType} not found` });
    }

    const generatedPrompt = buildSocialPrompt({ sourceType, source, platform });

    const post = await SocialPost.create({
      sourceType,
      sourceId,
      sourceSlug: sourceType === "COURSE" ? source.courseSlug || source.id || null : source.slug || null,
      sourceTitle: sourceType === "COURSE" ? source.courseTitle : source.title,
      platform,
      status: "AWAITING_PASTE",
      generatedPrompt,
    });

    return res.status(201).json({ success: true, data: post, message: "Prompt generated" });
  } catch (err) {
    console.error("[SocialFactory] createPost error:", err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : "Server error" });
  }
};

// POST /admin/social-factory/posts/:id/submit-response — the admin pastes
// back what Claude.ai Pro returned when they ran the generated prompt.
export const submitResponse = async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ success: false, message: "text is required" });
    }

    const post = await SocialPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    if (!["AWAITING_PASTE", "NEEDS_REVISION"].includes(post.status)) {
      return res.status(409).json({ success: false, message: `Cannot submit a response while post is ${post.status}` });
    }

    post.pastedResponseRaw = text;

    try {
      const parsedPost = parseSocialPostResponse(text);
      post.post = parsedPost;
      post.parseError = null;
      post.status = "PARSED";
    } catch (parseErr) {
      post.parseError = parseErr.message;
      // status stays AWAITING_PASTE / NEEDS_REVISION — admin can re-paste
    }

    await post.save();
    return res.json({ success: true, data: post });
  } catch (err) {
    console.error("[SocialFactory] submitResponse error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PATCH /admin/social-factory/posts/:id — manual edits to the parsed post fields.
export const updatePost = async (req, res) => {
  try {
    const post = await SocialPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    const { caption, hashtags, imagePromptSuggestion, altText, cta } = req.body || {};
    if (caption !== undefined) post.post.caption = caption;
    if (hashtags !== undefined) post.post.hashtags = Array.isArray(hashtags) ? hashtags : post.post.hashtags;
    if (imagePromptSuggestion !== undefined) post.post.imagePromptSuggestion = imagePromptSuggestion;
    if (altText !== undefined) post.post.altText = altText;
    if (cta !== undefined) post.post.cta = cta;
    if (post.post.caption) post.post.characterCount = post.post.caption.length;

    await post.save();
    return res.json({ success: true, data: post });
  } catch (err) {
    console.error("[SocialFactory] updatePost error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/social-factory/posts/:id/approve
export const approvePost = async (req, res) => {
  try {
    const post = await SocialPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    if (!["PARSED", "NEEDS_REVISION"].includes(post.status)) {
      return res.status(409).json({ success: false, message: `Cannot approve a post while it is ${post.status}` });
    }

    post.status = "APPROVED";
    post.reviewedBy = req.admin?.email || req.admin?.name || null;
    post.reviewedAt = new Date();
    await post.save();

    return res.json({ success: true, data: post });
  } catch (err) {
    console.error("[SocialFactory] approvePost error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/social-factory/posts/:id/reject
export const rejectPost = async (req, res) => {
  try {
    const { reason } = req.body || {};
    const post = await SocialPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    if (["SCHEDULED", "PUBLISHED", "REJECTED"].includes(post.status)) {
      return res.status(409).json({ success: false, message: `Cannot reject a post while it is ${post.status}` });
    }

    post.status = "REJECTED";
    post.rejectionReason = reason || null;
    post.reviewedBy = req.admin?.email || req.admin?.name || null;
    post.reviewedAt = new Date();
    await post.save();

    return res.json({ success: true, data: post });
  } catch (err) {
    console.error("[SocialFactory] rejectPost error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/social-factory/posts/:id/schedule
export const schedulePost = async (req, res) => {
  try {
    const { scheduledAt } = req.body || {};
    if (!scheduledAt) return res.status(400).json({ success: false, message: "scheduledAt is required" });

    const post = await SocialPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    if (post.status !== "APPROVED") {
      return res.status(409).json({ success: false, message: "Only an APPROVED post can be scheduled" });
    }

    post.scheduledAt = new Date(scheduledAt);
    post.status = "SCHEDULED";
    await post.save();

    return res.json({ success: true, data: post, message: "Scheduled" });
  } catch (err) {
    console.error("[SocialFactory] schedulePost error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// DELETE /admin/social-factory/posts/:id
export const deletePost = async (req, res) => {
  try {
    const post = await SocialPost.findByIdAndDelete(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    return res.json({ success: true, message: "Post deleted" });
  } catch (err) {
    console.error("[SocialFactory] deletePost error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
