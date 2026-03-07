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
    const { courseTitle, courseDescription, platform, style } = req.body;
    if (!courseTitle) return res.status(400).json({ message: "courseTitle is required." });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ message: "AI generation not configured. Add ANTHROPIC_API_KEY to .env" });
    }

    const charLimits = { linkedin: 3000, instagram: 2200, facebook: 63000, x: 280 };
    const limit = charLimits[platform] || 500;

    const styleGuides = {
      promotional: "Write a promotional post with a strong CTA (e.g., 'Enroll now', 'Limited seats'). Include a discount mention if relevant.",
      educational: "Share a key insight or learning outcome from the course. Be informative and valuable, not salesy.",
      engagement: "Ask a thought-provoking question to spark discussion. Be conversational and relatable.",
    };

    const platformGuides = {
      linkedin: "Professional tone. Use relevant industry hashtags (3-5). Paragraph breaks for readability.",
      instagram: "Casual, energetic tone. Use 10-15 hashtags. Use relevant emojis. Story-driven hook in first line.",
      facebook: "Friendly, community-focused tone. Keep it concise. One clear CTA.",
      x: `Ultra-concise (max ${limit} chars). Punchy hook. 1-2 relevant hashtags.`,
    };

    const prompt = `You are a social media copywriter for Technohana, an online tech training platform.

Course: ${courseTitle}
${courseDescription ? `Description: ${courseDescription}` : ""}
Platform: ${platform || "linkedin"}
Style: ${style || "promotional"}

Style guide: ${styleGuides[style] || styleGuides.promotional}
Platform guide: ${platformGuides[platform] || platformGuides.linkedin}

Write a single social media post (under ${limit} characters). Return ONLY the post text, no explanations.`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-haiku-4-5-20251001",
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
    console.error("AI copy generation error:", err?.response?.data || err.message);
    return res.status(500).json({ message: "Failed to generate copy" });
  }
};
