import axios from "axios";
import SocialPost from "../models/socialPost.model.js";

// GET /admin/social-posts
export const getAllSocialPosts = async (req, res) => {
  try {
    const { status, platform, page = 1, limit = 20, month, year } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (status) filter.status = status;
    if (platform) filter.platforms = platform;
    if (month && year) {
      const start = new Date(parseInt(year), parseInt(month) - 1, 1);
      const end = new Date(parseInt(year), parseInt(month), 1);
      filter.scheduledAt = { $gte: start, $lt: end };
    }

    const [data, total] = await Promise.all([
      SocialPost.find(filter).sort({ scheduledAt: 1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      SocialPost.countDocuments(filter),
    ]);

    return res.json({ data, total, page: pageNum, limit: limitNum, pagination: { total } });
  } catch (err) {
    console.error("Get social posts error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /admin/social-posts/:id
export const getSocialPost = async (req, res) => {
  try {
    const post = await SocialPost.findById(req.params.id).lean();
    if (!post) return res.status(404).json({ message: "Post not found." });
    return res.json({ data: post });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /admin/social-posts
export const createSocialPost = async (req, res) => {
  try {
    const { platforms, text, imageUrl, scheduledAt, utmParams } = req.body;
    if (!text) return res.status(400).json({ message: "Post text is required." });
    if (!platforms || platforms.length === 0)
      return res.status(400).json({ message: "At least one platform is required." });

    const post = new SocialPost({ platforms, text, imageUrl, scheduledAt, utmParams });
    await post.save();
    return res.status(201).json({ data: post });
  } catch (err) {
    console.error("Create social post error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /admin/social-posts/:id
export const updateSocialPost = async (req, res) => {
  try {
    const { platforms, text, imageUrl, scheduledAt, utmParams, status } = req.body;
    const updated = await SocialPost.findByIdAndUpdate(
      req.params.id,
      { platforms, text, imageUrl, scheduledAt, utmParams, status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Post not found." });
    return res.json({ data: updated });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

// DELETE /admin/social-posts/:id
export const deleteSocialPost = async (req, res) => {
  try {
    const deleted = await SocialPost.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Post not found." });
    return res.json({ message: "Post deleted." });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /admin/social-posts/:id/publish
// Sends post to Buffer API for each platform
// POST /admin/social-posts/:id/publish
// Sends post data to a Make.com (or any) webhook URL for social publishing.
// Set SOCIAL_WEBHOOK_URL in .env — create a free Make.com scenario with a
// "Custom Webhook" trigger, then add social media posting modules to it.
export const publishToBuffer = async (req, res) => {
  try {
    const post = await SocialPost.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found." });

    const webhookUrl = process.env.SOCIAL_WEBHOOK_URL;
    if (!webhookUrl) {
      return res.status(503).json({
        message: "Publishing not configured. Add SOCIAL_WEBHOOK_URL to .env (use a Make.com webhook URL).",
      });
    }

    // Build final text, appending UTM URL if campaign params are set
    let finalText = post.text;
    if (post.utmParams?.campaign) {
      const base = process.env.FRONTEND_URL || "https://technohana.com";
      const url = new URL(base);
      url.searchParams.set("utm_source", post.utmParams.source || "social");
      url.searchParams.set("utm_medium", post.utmParams.medium || "social");
      url.searchParams.set("utm_campaign", post.utmParams.campaign);
      if (post.utmParams.content) url.searchParams.set("utm_content", post.utmParams.content);
      finalText = `${post.text}\n\n${url.toString()}`;
    }

    // Send to webhook — Make.com/Zapier receives this and routes to each platform
    await axios.post(webhookUrl, {
      text: finalText,
      imageUrl: post.imageUrl || null,
      platforms: post.platforms,
      scheduledAt: post.scheduledAt ? new Date(post.scheduledAt).toISOString() : null,
      postId: post._id.toString(),
    });

    post.status = post.scheduledAt ? "scheduled" : "published";
    if (!post.scheduledAt) post.publishedAt = new Date();
    await post.save();

    return res.json({ data: post });
  } catch (err) {
    console.error("Webhook publish error:", err?.response?.data || err.message);
    const msg = err?.response?.data?.message || err.message || "Webhook publish failed";
    return res.status(500).json({ message: msg });
  }
};

// POST /admin/social-posts/generate-copy
// Uses Anthropic API to generate platform-optimized post copy
export const generateSocialCopy = async (req, res) => {
  try {
    const { courseTitle, courseDescription, courseId, platform, style } = req.body;
    if (!courseTitle) return res.status(400).json({ message: "courseTitle is required." });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ message: "AI generation not configured. Add ANTHROPIC_API_KEY to .env" });
    }

    const courseUrl = courseId
      ? `https://technohana.in/courses/${courseId}`
      : "https://technohana.in/courses";

    const charLimits = { linkedin: 3000, instagram: 2200, facebook: 63000, x: 280 };
    const limit = charLimits[platform] || 500;

    const styleGuides = {
      promotional: "Write a promotional post with a strong CTA (e.g., 'Enroll now', 'Limited seats'). Mention group discounts up to 35% off if relevant.",
      educational: "Share a key insight or learning outcome from the course. Be informative and valuable, not salesy.",
      engagement: "Ask a thought-provoking question to spark discussion. Be conversational and relatable.",
    };

    const platformGuides = {
      linkedin: `Professional, authoritative tone. Open with a compelling hook (bold statement or question). Use short paragraphs (2-3 lines max). Include 3-5 relevant industry hashtags at the end. End with a clear CTA and the course link: ${courseUrl}`,
      instagram: `Energetic, benefit-focused tone. Start with a strong single-line hook. Follow with 2-3 short lines on key benefits. Use 10-15 relevant hashtags at the end. End caption with the course link: ${courseUrl}`,
      facebook: `Conversational, friendly tone. Use a problem-to-solution format. Keep it under 150 words. One clear CTA. Include the course link: ${courseUrl}`,
      x: `Ultra-concise (max ${limit} chars). Punchy one-line hook. 1-2 hashtags. Include link: ${courseUrl}`,
    };

    const prompt = `You are a social media copywriter for Technohana, an online tech training platform.

Course: ${courseTitle}
${courseDescription ? `Description: ${courseDescription}` : ""}
Platform: ${platform || "linkedin"}
Style: ${style || "promotional"}

Style guide: ${styleGuides[style] || styleGuides.promotional}
Platform guide: ${platformGuides[platform] || platformGuides.linkedin}

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
        max_tokens: 500,
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

    const copy = response.data.content?.[0]?.text?.trim() || "";
    return res.json({ copy });
  } catch (err) {
    const detail = err?.response?.data?.error?.message || err?.response?.data || err.message;
    console.error("AI copy generation error:", detail);
    return res.status(500).json({ message: "Failed to generate copy", detail });
  }
};
