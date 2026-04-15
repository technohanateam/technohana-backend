import axios from "axios";
import PipelineDraft from "../models/pipelineDraft.model.js";
import SocialPost from "../models/socialPost.model.js";

const CHAR_LIMITS = {
  "linkedin-personal": 3000,
  "linkedin-company": 3000,
  instagram: 2200,
  facebook: 63000,
  x: 280,
};

const PLATFORM_GUIDES = {
  "linkedin-personal": (limit, url) =>
    `Professional, authoritative tone. Open with a compelling hook. Use short paragraphs (2-3 lines max). Include 3-5 relevant hashtags at the end. End with a clear CTA and the link: ${url}`,
  "linkedin-company": (limit, url) =>
    `Professional, brand voice. Open with a compelling hook. Use short paragraphs. Include 3-5 relevant hashtags at the end. End with a clear CTA and the link: ${url}`,
  instagram: (limit, url) =>
    `Energetic, benefit-focused tone. Start with a strong single-line hook. Follow with 2-3 short lines on key benefits. Use 10-15 relevant hashtags at the end. End with the link: ${url}`,
  facebook: (limit, url) =>
    `Conversational, friendly tone. Use a problem-to-solution format. Keep it under 150 words. One clear CTA. Include the link: ${url}`,
  x: (limit, url) =>
    `Ultra-concise (max ${limit} chars). Punchy one-line hook. 1-2 hashtags. Include link: ${url}`,
};

function computeStageStatus(draft) {
  const brief = draft.brief || {};
  const creativePack = draft.creativePack || {};
  const socialPack = draft.socialPack || {};
  const platforms = brief.platforms || [];

  // Brief
  let briefStatus = "not_started";
  if (brief.topic?.trim() && brief.trainingType) briefStatus = "ready";
  else if (brief.topic?.trim()) briefStatus = "in_progress";

  // Creatives
  let creativesStatus = "not_started";
  if ((creativePack.exportedAssets || []).length > 0) creativesStatus = "ready";
  else if ((creativePack.selectedVariants || []).length > 0) creativesStatus = "in_progress";

  // Posts
  let postsStatus = "not_started";
  if (platforms.length > 0) {
    const posts = socialPack.posts || {};
    const ready = platforms.filter((p) => String(posts[p] || "").trim()).length;
    if (ready === platforms.length) postsStatus = "ready";
    else if (ready > 0) postsStatus = "in_progress";
  }

  // Publish
  let publishStatus = "not_started";
  if (draft.status === "published") publishStatus = "published";
  else if (postsStatus === "ready") publishStatus = "in_progress";

  return { brief: briefStatus, creatives: creativesStatus, posts: postsStatus, publish: publishStatus };
}

// POST /admin/pipeline-drafts
export const createPipelineDraft = async (req, res) => {
  try {
    const { mode, brief, creativePack, socialPack, status } = req.body;
    const draft = new PipelineDraft({
      mode: mode || "quick_ops",
      brief: brief || {},
      creativePack: creativePack || {},
      socialPack: socialPack || {},
      status: status || "draft",
      createdBy: req.admin?._id,
      createdByRole: req.admin?.role,
    });
    draft.stageStatus = computeStageStatus(draft);
    await draft.save();
    return res.status(201).json({ success: true, data: draft });
  } catch (err) {
    console.error("createPipelineDraft error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to create pipeline draft." });
  }
};

// GET /admin/pipeline-drafts
export const listPipelineDrafts = async (req, res) => {
  try {
    const drafts = await PipelineDraft.find({}).sort({ updatedAt: -1 }).limit(50).lean();
    return res.json({ success: true, data: drafts });
  } catch (err) {
    console.error("listPipelineDrafts error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to list pipeline drafts." });
  }
};

// GET /admin/pipeline-drafts/:id
export const getPipelineDraft = async (req, res) => {
  try {
    const draft = await PipelineDraft.findById(req.params.id).lean();
    if (!draft) return res.status(404).json({ success: false, message: "Pipeline draft not found." });
    return res.json({ success: true, data: draft });
  } catch (err) {
    console.error("getPipelineDraft error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to get pipeline draft." });
  }
};

// PATCH /admin/pipeline-drafts/:id
export const updatePipelineDraft = async (req, res) => {
  try {
    const draft = await PipelineDraft.findById(req.params.id);
    if (!draft) return res.status(404).json({ success: false, message: "Pipeline draft not found." });

    const { mode, brief, creativePack, socialPack, status } = req.body;
    if (mode !== undefined) draft.mode = mode;
    if (brief !== undefined) draft.brief = { ...draft.brief.toObject?.() ?? draft.brief, ...brief };
    if (creativePack !== undefined) draft.creativePack = { ...draft.creativePack.toObject?.() ?? draft.creativePack, ...creativePack };
    if (socialPack !== undefined) draft.socialPack = { ...draft.socialPack.toObject?.() ?? draft.socialPack, ...socialPack };
    if (status !== undefined) draft.status = status;

    draft.stageStatus = computeStageStatus(draft);
    draft.markModified("brief");
    draft.markModified("creativePack");
    draft.markModified("socialPack");
    draft.markModified("stageStatus");
    await draft.save();
    return res.json({ success: true, data: draft });
  } catch (err) {
    console.error("updatePipelineDraft error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to update pipeline draft." });
  }
};

// POST /admin/pipeline-drafts/:id/generate-copy
export const generatePipelineCopy = async (req, res) => {
  try {
    const draft = await PipelineDraft.findById(req.params.id);
    if (!draft) return res.status(404).json({ success: false, message: "Pipeline draft not found." });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ success: false, message: "AI generation not configured. Add ANTHROPIC_API_KEY to .env" });
    }

    const { platforms: reqPlatforms, style } = req.body;
    const platforms = reqPlatforms || draft.brief?.platforms || [];
    if (!platforms.length) {
      return res.status(400).json({ success: false, message: "No platforms selected." });
    }

    const topic = draft.brief?.topic || "";
    if (!topic.trim()) {
      return res.status(400).json({ success: false, message: "Brief topic is required before generating copy." });
    }

    const offer = draft.brief?.offer || "";
    const cta = draft.brief?.ctaTemplate || "Enroll now";
    const trainingType = draft.brief?.trainingType || "individual";
    const courseUrl = `https://technohana.in/courses`;

    const styleGuides = {
      promotional: `Write a promotional post with a strong CTA ("${cta}"). ${offer ? `Highlight the offer: ${offer}.` : ""} ${trainingType === "corporate" ? "Mention group discounts up to 35% off." : ""}`,
      educational: "Share a key insight or learning outcome from the course. Be informative and valuable, not salesy.",
      engagement: "Ask a thought-provoking question to spark discussion. Be conversational and relatable.",
    };
    const chosenStyle = style || "promotional";

    const posts = { ...(draft.socialPack?.posts || {}) };

    for (const platform of platforms) {
      const limit = CHAR_LIMITS[platform] || 500;
      const normalizedPlatform = platform.startsWith("linkedin") ? "linkedin" : platform;
      const platformGuide = PLATFORM_GUIDES[platform]
        ? PLATFORM_GUIDES[platform](limit, courseUrl)
        : `Write a social post under ${limit} characters. Include the link: ${courseUrl}`;

      const prompt = `You are a social media copywriter for Technohana, an online tech training platform.

Course/Topic: ${topic}
Platform: ${platform}
Style: ${chosenStyle}

Style guide: ${styleGuides[chosenStyle] || styleGuides.promotional}
Platform guide: ${platformGuide}

Rules:
- Do NOT use emojis, emoji symbols, or decorative checkmarks (e.g. ✅, 🎓, 🚀, ✔️)
- Do NOT use bullet points with dashes or asterisks unless it is a LinkedIn post
- Write plain, confident, human copy — no hype words like "game-changing" or "revolutionary"
- Always include the course link naturally within the post

Write a single social media post (under ${limit} characters). Return ONLY the post text, no explanations.`;

      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-opus-4-6",
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
        }
      );

      posts[platform] = response.data.content?.[0]?.text?.trim() || "";
    }

    draft.socialPack = {
      ...(draft.socialPack?.toObject?.() ?? draft.socialPack ?? {}),
      posts,
    };
    draft.stageStatus = computeStageStatus(draft);
    draft.markModified("socialPack");
    draft.markModified("stageStatus");
    await draft.save();

    return res.json({ success: true, data: draft });
  } catch (err) {
    const detail = err?.response?.data?.error?.message || err?.response?.data || err.message;
    console.error("generatePipelineCopy error:", detail);
    return res.status(500).json({ success: false, message: "Failed to generate copy.", detail });
  }
};

// POST /admin/pipeline-drafts/:id/export-creatives
export const exportPipelineCreatives = async (req, res) => {
  try {
    const draft = await PipelineDraft.findById(req.params.id);
    if (!draft) return res.status(404).json({ success: false, message: "Pipeline draft not found." });

    const { selectedVariants, overrides, assets } = req.body;

    draft.creativePack = {
      selectedVariants: selectedVariants || draft.creativePack?.selectedVariants || [],
      overrides: overrides || draft.creativePack?.overrides || {},
      exportedAssets: assets || draft.creativePack?.exportedAssets || [],
    };

    draft.stageStatus = computeStageStatus(draft);
    draft.markModified("creativePack");
    draft.markModified("stageStatus");
    await draft.save();

    return res.json({ success: true, data: draft });
  } catch (err) {
    console.error("exportPipelineCreatives error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to export creatives." });
  }
};

// POST /admin/pipeline-drafts/:id/publish-social
export const publishPipelineSocial = async (req, res) => {
  try {
    const draft = await PipelineDraft.findById(req.params.id);
    if (!draft) return res.status(404).json({ success: false, message: "Pipeline draft not found." });

    // Idempotency: already published
    if (draft.status === "published") {
      return res.json({ success: true, data: draft });
    }

    // Server-side canPublish check
    const stages = draft.stageStatus || {};
    if (stages.brief !== "ready") {
      return res.status(400).json({ success: false, message: "Brief stage is not ready." });
    }
    if (draft.mode === "launch_campaign" && stages.creatives !== "ready") {
      return res.status(400).json({ success: false, message: "Creatives stage is not ready for launch campaign." });
    }
    if (stages.posts !== "ready") {
      return res.status(400).json({ success: false, message: "Posts stage is not ready." });
    }

    const posts = draft.socialPack?.posts || {};
    const platforms = draft.brief?.platforms || [];
    const utm = draft.socialPack?.utm || {};
    const scheduleDate = draft.socialPack?.schedule?.date;
    const scheduleTimes = draft.socialPack?.schedule?.times || {};

    const webhookUrl = process.env.SOCIAL_WEBHOOK_URL;

    for (const platform of platforms) {
      const text = String(posts[platform] || "").trim();
      if (!text) continue;

      let scheduledAt;
      if (scheduleDate && scheduleTimes[platform]) {
        scheduledAt = new Date(`${scheduleDate}T${scheduleTimes[platform]}:00`);
      } else if (scheduleDate) {
        scheduledAt = new Date(`${scheduleDate}T09:00:00`);
      }

      const socialPost = new SocialPost({
        platforms: [platform],
        text,
        imageUrl: "",
        status: scheduledAt ? "scheduled" : "draft",
        scheduledAt: scheduledAt || undefined,
        utmParams: {
          source: utm.source || "",
          medium: utm.medium || "",
          campaign: utm.campaign || "",
          content: utm.content || "",
        },
        createdBy: req.admin?._id,
        createdByRole: req.admin?.role,
      });
      await socialPost.save();

      if (webhookUrl) {
        let finalText = text;
        if (utm.campaign) {
          const base = process.env.FRONTEND_URL || "https://technohana.com";
          const url = new URL(base);
          url.searchParams.set("utm_source", utm.source || "social");
          url.searchParams.set("utm_medium", utm.medium || "social");
          url.searchParams.set("utm_campaign", utm.campaign);
          if (utm.content) url.searchParams.set("utm_content", utm.content);
          finalText = `${text}\n\n${url.toString()}`;
        }
        try {
          await axios.post(webhookUrl, {
            text: finalText,
            imageUrl: null,
            platforms: [platform],
            scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
            postId: socialPost._id.toString(),
          });
          socialPost.status = scheduledAt ? "scheduled" : "published";
          if (!scheduledAt) socialPost.publishedAt = new Date();
          await socialPost.save();
        } catch (webhookErr) {
          console.error("Webhook error for platform", platform, webhookErr?.response?.data || webhookErr.message);
        }
      }
    }

    draft.status = "published";
    draft.publishedAt = new Date();
    draft.stageStatus = { ...computeStageStatus(draft), publish: "published" };
    draft.markModified("stageStatus");
    await draft.save();

    return res.json({ success: true, data: draft });
  } catch (err) {
    console.error("publishPipelineSocial error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to publish social plan." });
  }
};
