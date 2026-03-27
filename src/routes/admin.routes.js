import express from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { fileURLToPath } from "url";
import { User } from "../models/user.model.js";
import Enquiry from "../models/enquiry.model.js";
import Instructor from "../models/instructor.js";
import AiRiskReport from "../models/aiRiskReport.model.js";
import Testimonial from "../models/testimonial.model.js";
import Subscription from "../models/subscription.model.js";
import { Blogs } from "../models/blogs.model.js";
import Course from "../models/course.model.js";
import { CourseView } from "../models/courseView.model.js";
import { authenticateAdmin, requireAdmin } from "../middleware/authenticateAdmin.js";
import { getAllCoupons, getCoupon, createCoupon, updateCoupon, deleteCoupon, resetCouponUsage, getCouponStats } from "../controllers/coupon.controller.js";
import { getReferralAnalytics, getReferralsList, getReferrerDetails, getReferralMetrics } from "../controllers/admin-referral.controller.js";
import { getAllCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign, sendCampaignNow, scheduleCampaign, pauseCampaign, resumeCampaign, getCampaignAnalytics, estimateSegmentSize, getCampaignQueueStats } from "../controllers/campaign.controller.js";
import { getAllSocialPosts, getSocialPost, createSocialPost, updateSocialPost, deleteSocialPost, publishToBuffer, generateSocialCopy } from "../controllers/social-post.controller.js";
import Campaign from "../models/campaign.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ─── POST /admin/login ────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  let role = null;
  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    role = "admin";
  } else if (process.env.SALES_EMAIL && email === process.env.SALES_EMAIL && password === process.env.SALES_PASSWORD) {
    role = "sales";
  } else if (process.env.MARKETING_EMAIL && email === process.env.MARKETING_EMAIL && password === process.env.MARKETING_PASSWORD) {
    role = "marketing";
  }

  if (!role) {
    return res.status(401).json({ message: "Invalid credentials." });
  }

  const token = jwt.sign(
    { email, role },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: "8h" }
  );

  return res.json({ token });
});

// ─── All routes below require admin auth ──────────────────────────────────────

// GET /admin/stats
router.get("/stats", authenticateAdmin, async (req, res) => {
  try {
    const [
      totalEnrollments,
      pendingPayment,
      inProgress,
      enrolled,
      rejected,
      enquiries,
      aiRiskReports,
      subscribers,
      blogs,
      courses,
      courseViews,
      abandonedEnrollments,
      activeReferrers,
      activeCampaigns,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: "pending-payment" }),
      User.countDocuments({ status: "in-progress" }),
      User.countDocuments({ status: "enrolled" }),
      User.countDocuments({ status: "rejected" }),
      Enquiry.countDocuments(),
      AiRiskReport.countDocuments(),
      Subscription.countDocuments({ isActive: true }),
      Blogs.countDocuments(),
      Course.countDocuments(),
      CourseView.countDocuments(),
      User.countDocuments({ enrollmentFormAbandonedAt: { $ne: null }, enrollmentReminderSent: false }),
      User.countDocuments({ referralCode: { $ne: null }, referralCount: { $gt: 0 } }),
      Campaign.countDocuments({ status: { $ne: "deleted" }, isPaused: false }),
    ]);

    return res.json({
      enrollments: { total: totalEnrollments, pendingPayment, inProgress, enrolled, rejected },
      enquiries,
      aiRiskReports,
      subscribers,
      blogs,
      courses,
      courseViews,
      abandonedEnrollments,
      activeReferrers,
      activeCampaigns,
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/enrollments?status=&search=&page=1&limit=20
router.get("/enrollments", authenticateAdmin, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { courseTitle: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      User.find(query).sort({ _id: -1 }).skip(skip).limit(Number(limit)).lean(),
      User.countDocuments(query),
    ]);

    return res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Admin enrollments error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /admin/enrollments/:id/status
router.patch("/enrollments/:id/status", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    const allowed = ["pending-payment", "in-progress", "enrolled", "rejected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    const update = { status };
    if (status === "rejected" && rejectionReason) update.rejectionReason = rejectionReason;

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Enrollment not found." });

    return res.json({ data: updated });
  } catch (err) {
    console.error("Admin update status error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/enrollments/:id
router.delete("/enrollments/:id", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Enrollment not found." });
    return res.json({ message: "Enrollment deleted.", data: deleted });
  } catch (err) {
    console.error("Admin delete enrollment error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/enquiries?page=1&limit=20
router.get("/enquiries", authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      Enquiry.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Enquiry.countDocuments(),
    ]);
    return res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Admin enquiries error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/enquiries/clear
router.delete("/enquiries/clear", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const result = await Enquiry.deleteMany({});
    return res.json({ message: "Cleared all enquiries", deleted: result.deletedCount });
  } catch (err) {
    console.error("Admin clear enquiries error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/enquiries/:id
router.delete("/enquiries/:id", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const deleted = await Enquiry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Enquiry not found." });
    return res.json({ message: "Enquiry deleted." });
  } catch (err) {
    console.error("Admin delete enquiry error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /admin/enquiries/:id — update status, notes, assignedTo, nextFollowUp, lostReason
router.patch("/enquiries/:id", authenticateAdmin, async (req, res) => {
  try {
    const { status, notes, assignedTo, nextFollowUp, lostReason } = req.body;
    const allowed = {};
    if (status !== undefined) allowed.status = status;
    if (notes !== undefined) allowed.notes = notes;
    if (assignedTo !== undefined) allowed.assignedTo = assignedTo;
    if (nextFollowUp !== undefined) allowed.nextFollowUp = nextFollowUp || null;
    if (lostReason !== undefined) allowed.lostReason = lostReason;
    const updated = await Enquiry.findByIdAndUpdate(req.params.id, allowed, { new: true });
    if (!updated) return res.status(404).json({ message: "Enquiry not found." });
    return res.json(updated);
  } catch (err) {
    console.error("Admin patch enquiry error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/pipeline-stats — stage breakdown, stale counts, win rate, follow-up due today
router.get("/pipeline-stats", authenticateAdmin, async (req, res) => {
  try {
    const now = new Date();
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const staleNewCutoff = new Date(now - 3 * 24 * 60 * 60 * 1000);
    const staleContactedCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);

    const [stageCounts, staleNew, staleContacted, winsThisWeek, totalWon, totalLost, followUpDueToday] = await Promise.all([
      Enquiry.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Enquiry.countDocuments({ status: "new", createdAt: { $lt: staleNewCutoff } }),
      Enquiry.countDocuments({ status: "contacted", createdAt: { $lt: staleContactedCutoff } }),
      Enquiry.countDocuments({ status: "won", createdAt: { $gte: weekStart } }),
      Enquiry.countDocuments({ status: "won" }),
      Enquiry.countDocuments({ status: "lost" }),
      Enquiry.countDocuments({ nextFollowUp: { $lte: todayEnd, $ne: null } }),
    ]);

    const stages = { new: 0, contacted: 0, quoted: 0, won: 0, lost: 0 };
    for (const { _id, count } of stageCounts) if (_id in stages) stages[_id] = count;

    const closedDeals = totalWon + totalLost;
    const winRate = closedDeals > 0 ? Math.round((totalWon / closedDeals) * 100) : 0;

    return res.json({ stages, staleNew, staleContacted, winsThisWeek, winRate, followUpDueToday });
  } catch (err) {
    console.error("Pipeline stats error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/testimonials?page=1&limit=20&status=pending
router.get("/testimonials", authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = status && status !== "all" ? { status } : {};
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      Testimonial.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Testimonial.countDocuments(filter),
    ]);
    return res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Admin testimonials error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /admin/testimonials/:id — update status (approved/rejected/pending)
router.patch("/testimonials/:id", authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await Testimonial.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!updated) return res.status(404).json({ message: "Testimonial not found." });
    return res.json(updated);
  } catch (err) {
    console.error("Admin patch testimonial error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/testimonials/:id
router.delete("/testimonials/:id", authenticateAdmin, async (req, res) => {
  try {
    const deleted = await Testimonial.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Testimonial not found." });
    return res.json({ message: "Testimonial deleted." });
  } catch (err) {
    console.error("Admin delete testimonial error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/ai-risk-reports?page=1&limit=20
router.get("/ai-risk-reports", authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      AiRiskReport.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      AiRiskReport.countDocuments(),
    ]);
    return res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Admin AI risk reports error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/ai-risk-reports/clear
router.delete("/ai-risk-reports/clear", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { deletedCount } = await AiRiskReport.deleteMany({});
    return res.json({ message: "Cleared all AI risk reports", deleted: deletedCount });
  } catch (err) {
    console.error("Clear AI risk reports error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/ai-risk-reports/:id
router.delete("/ai-risk-reports/:id", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const result = await AiRiskReport.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ message: "Not found" });
    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error("Delete AI risk report error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/subscribers?page=1&limit=20
router.get("/subscribers", authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      Subscription.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Subscription.countDocuments(),
    ]);
    return res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Admin subscribers error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/blogs
router.get("/blogs", authenticateAdmin, async (req, res) => {
  try {
    const data = await Blogs.find().sort({ _id: -1 }).lean();
    return res.json({ data });
  } catch (err) {
    console.error("Admin blogs error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /admin/blogs
router.post("/blogs", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { title, slug, img, author, date, content, category, excerpt, metaTitle, metaDescription, focusKeyword, tags, readTimeMin } = req.body;
    if (!title) return res.status(400).json({ message: "Title is required." });

    const lastBlog = await Blogs.findOne().sort({ id: -1 }).lean();
    const nextId = lastBlog ? (lastBlog.id || 0) + 1 : 1;

    const generatedSlug =
      slug ||
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    const blog = new Blogs({
      id: nextId,
      title,
      slug: generatedSlug,
      img: img || "",
      author: author || "",
      date: date || new Date().toISOString().split("T")[0],
      content: content || "",
      category: category || "",
      excerpt: excerpt || "",
      metaTitle: metaTitle || "",
      metaDescription: metaDescription || "",
      focusKeyword: focusKeyword || "",
      tags: tags || [],
      readTimeMin: readTimeMin || null,
    });
    await blog.save();
    return res.status(201).json({ data: blog });
  } catch (err) {
    console.error("Admin create blog error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PUT /admin/blogs/:id
router.put("/blogs/:id", authenticateAdmin, async (req, res) => {
  try {
    const { title, slug, img, author, date, content, category, excerpt, metaTitle, metaDescription, focusKeyword, tags, readTimeMin } = req.body;
    const updated = await Blogs.findByIdAndUpdate(
      req.params.id,
      { title, slug, img, author, date, content, category, excerpt, metaTitle, metaDescription, focusKeyword, tags, readTimeMin },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Blog not found." });
    return res.json({ data: updated });
  } catch (err) {
    console.error("Admin update blog error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/blogs/:id
router.delete("/blogs/:id", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const deleted = await Blogs.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Blog not found." });
    return res.json({ message: "Blog deleted." });
  } catch (err) {
    console.error("Admin delete blog error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /admin/blogs/seed-static — bulk import static blog posts, skip existing slugs
router.post("/blogs/seed-static", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const posts = req.body;
    if (!Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({ message: "Expected array of blog posts." });
    }
    const existing = await Blogs.find({}, { slug: 1 }).lean();
    const existingSlugs = new Set(existing.map((b) => b.slug));
    const toInsert = posts
      .filter((p) => p.slug && !existingSlugs.has(p.slug))
      .map(({ id, _id, ...rest }) => rest); // strip static id fields
    if (toInsert.length === 0) {
      return res.json({ inserted: 0, skipped: posts.length, message: "All posts already exist in the database." });
    }
    await Blogs.insertMany(toInsert, { ordered: false });
    return res.json({ inserted: toInsert.length, skipped: posts.length - toInsert.length });
  } catch (err) {
    console.error("Blog seed error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /admin/blogs/generate-from-course — AI-generate a blog post for a course
router.post("/blogs/generate-from-course", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { courseId, courseTitle, category, description } = req.body;
    if (!courseTitle) return res.status(400).json({ message: "courseTitle is required." });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ message: "AI generation not configured. Add ANTHROPIC_API_KEY to .env" });

    const prompt = `You are an SEO content writer for Technohana, an online tech training company based in India with global students.

Write a complete, high-quality blog post for the following course:
Course: ${courseTitle}
Category: ${category || "Technology"}
${description ? `Description: ${description}` : ""}

Return ONLY a valid JSON object (no markdown, no code fences, no explanation) with these exact keys:
- "title": compelling blog post title (NOT the course title; e.g. "Why Every Professional Should Learn [Topic]" or "The Complete Guide to [Topic] in 2025")
- "slug": URL-friendly slug derived from the title
- "excerpt": 2–3 sentence summary (aim for 140–160 characters)
- "content": full blog post in clean HTML using <h2>, <p>, <ul>, <li> tags. Minimum 700 words. Structure: intro paragraph, 4–5 sections with <h2> headings, a practical tips section, conclusion paragraph with a call-to-action to explore Technohana courses at https://technohana.in/courses. Naturally include 2 internal links: one using <a href="/courses/${courseId || "COURSE_ID"}">${courseTitle}</a> and one to <a href="/blog/">related Technohana blog posts</a>.
- "metaTitle": SEO meta title, 50–60 characters, includes focus keyword
- "metaDescription": SEO meta description, 140–160 characters, includes focus keyword and a benefit
- "focusKeyword": primary target keyword phrase (2–4 words)
- "tags": array of 4–6 relevant tag strings
- "readTimeMin": estimated reading time in minutes (number)
- "author": "Technohana Team"
- "category": "${category || "Technology"}"

Writing rules:
- No emojis anywhere
- Clean, professional prose — no hype words ("game-changing", "revolutionary")
- Focus keyword must appear in title, first paragraph, and at least one <h2>
- HTML must be valid and well-structured`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-opus-4-6",
        max_tokens: 8192,
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

    const raw = response.data.content?.[0]?.text?.trim() || "";
    let generated;
    try {
      generated = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      generated = match ? JSON.parse(match[0]) : null;
    }
    if (!generated) return res.status(500).json({ message: "Failed to parse AI response.", raw });
    return res.json({ data: generated });
  } catch (err) {
    const detail = err?.response?.data?.error?.message || err.message;
    console.error("Blog generation error:", detail);
    return res.status(500).json({ message: "Failed to generate blog.", detail });
  }
});

// POST /admin/blogs/rewrite — AI-rewrite and improve an existing blog post
router.post("/blogs/rewrite", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { title, content, excerpt, category, focusKeyword, author } = req.body;
    if (!title || !content) return res.status(400).json({ message: "title and content are required." });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ message: "AI rewrite not configured. Add ANTHROPIC_API_KEY to .env" });

    const prompt = `You are an SEO content editor for Technohana, an online tech training company based in India with global students.

Rewrite and significantly improve the following existing blog post. Keep the same topic and core message but make it substantially better.

Current post:
Title: ${title}
Category: ${category || "Technology"}
Focus keyword: ${focusKeyword || ""}
Excerpt: ${excerpt || ""}
Content:
${content}

Improvements required:
- Deepen the content with specific data, statistics, real examples, and step-by-step guidance
- Improve SEO: place focus keyword naturally in title, first paragraph, and at least one <h2>
- Sharpen readability: shorter paragraphs, clear prose, no hype words ("game-changing", "revolutionary")
- Structure: intro paragraph, 4–5 sections with <h2> headings, conclusion with CTA to https://technohana.in/courses
- Include 2 internal links: one to <a href="/courses/">Technohana courses</a> and one to <a href="/blog/">related blog posts</a>
- Minimum 700 words, valid semantic HTML

Return ONLY a valid JSON object (no markdown, no code fences, no explanation) with these exact keys:
- "title": improved blog post title
- "slug": URL-friendly slug derived from the title
- "excerpt": 2–3 sentence summary (aim for 140–160 characters)
- "content": full rewritten blog post in clean HTML using <h2>, <p>, <ul>, <li> tags
- "metaTitle": SEO meta title, 50–60 characters, includes focus keyword
- "metaDescription": SEO meta description, 140–160 characters, includes focus keyword and a benefit
- "focusKeyword": primary target keyword phrase (2–4 words)
- "tags": array of 4–6 relevant tag strings
- "readTimeMin": estimated reading time in minutes (number)
- "author": "${author || "Technohana Team"}"
- "category": "${category || "Technology"}"

Writing rules:
- No emojis anywhere
- Clean, professional prose
- HTML must be valid and well-structured`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-opus-4-6",
        max_tokens: 8192,
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

    const raw = response.data.content?.[0]?.text?.trim() || "";
    let generated;
    try {
      generated = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      generated = match ? JSON.parse(match[0]) : null;
    }
    if (!generated) return res.status(500).json({ message: "Failed to parse AI response.", raw });
    return res.json({ data: generated });
  } catch (err) {
    const detail = err?.response?.data?.error?.message || err.message;
    console.error("Blog rewrite error:", detail);
    return res.status(500).json({ message: "Failed to rewrite blog.", detail });
  }
});

// POST /admin/blogs/cleanup-2026 — remove stale posts + update data science title
router.post("/blogs/cleanup-2026", authenticateAdmin, requireAdmin, async (req, res) => {
  const slugsToRemove = [
    "how-entrepreneurs-can-use-chatgpt-as-their-business-coach",
    "microsofts-3-billion-ai-investment-a-game-changer-for-india",
    "bridging-the-ai-skills-gap-how-indias-workforce-is-evolving-to-lead-the-ai-revolution",
    "real-world-applications-of-ai-driving-business-impact",
    "top-5-microsoft-ai-certifications-to-boost-your-career-in-2025",
  ];
  const deleted = await Blog.deleteMany({ slug: { $in: slugsToRemove } });
  const updated = await Blog.updateOne(
    { slug: "how-to-build-a-career-in-data-science-in-india-2025-roadmap" },
    { $set: { title: "How to Build a Career in Data Science in India: 2026 Roadmap" } }
  );
  return res.json({ deleted: deleted.deletedCount, updated: updated.modifiedCount });
});

// ─── Courses ──────────────────────────────────────────────────────────────────

// GET /admin/courses?category=&search=&page=1&limit=20
router.get("/courses", authenticateAdmin, async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;
    const query = {};
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { courseTitle: { $regex: search, $options: "i" } },
        { instructor: { $regex: search, $options: "i" } },
        { id: { $regex: search, $options: "i" } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      Course.find(query).sort({ category: 1, id: 1 }).skip(skip).limit(Number(limit)).lean(),
      Course.countDocuments(query),
    ]);
    return res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Admin courses error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /admin/courses
router.post("/courses", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { courseTitle, id } = req.body;
    if (!courseTitle) return res.status(400).json({ message: "courseTitle is required." });

    const course = new Course(req.body);
    await course.save();
    return res.status(201).json({ data: course });
  } catch (err) {
    console.error("Admin create course error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PUT /admin/courses/:id
router.put("/courses/:id", authenticateAdmin, async (req, res) => {
  try {
    const updated = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: "Course not found." });
    return res.json({ data: updated });
  } catch (err) {
    console.error("Admin update course error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/courses/:id
router.delete("/courses/:id", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const deleted = await Course.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Course not found." });
    return res.json({ message: "Course deleted." });
  } catch (err) {
    console.error("Admin delete course error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/courses/clear — clear all courses
router.delete("/courses/clear", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const result = await Course.deleteMany({});
    return res.json({ message: "Cleared all courses", deleted: result.deletedCount });
  } catch (err) {
    console.error("Admin clear courses error:", err);
    return res.status(500).json({ message: "Server error", detail: err.message });
  }
});

// POST /admin/courses/seed — additive sync from src/data/courses.json (only inserts missing courses by id)
router.post("/courses/seed", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const dataPath = path.join(__dirname, "../data/courses.json");
    const raw = fs.readFileSync(dataPath, "utf-8");
    const courses = JSON.parse(raw);

    const existingIds = new Set(
      (await Course.find({}, { id: 1, _id: 0 })).map(c => c.id)
    );
    const toInsert = courses.filter(c => c.id && !existingIds.has(c.id));

    if (toInsert.length === 0) {
      const total = await Course.countDocuments();
      return res.json({ message: `All courses already in DB`, count: total });
    }

    const result = await Course.insertMany(toInsert, { ordered: false });
    const total = await Course.countDocuments();
    return res.status(201).json({
      message: `Seeded ${result.length} new courses successfully`,
      inserted: result.length,
      total,
    });
  } catch (err) {
    console.error("Admin seed courses error:", err);
    if (err.writeErrors?.length > 0) {
      const total = await Course.countDocuments();
      return res.status(207).json({
        message: "Partial seed - some courses failed",
        detail: err.writeErrors.map(e => e.err.errmsg),
        errors: err.writeErrors.length,
        total,
      });
    }
    return res.status(500).json({ message: "Server error", detail: err.message });
  }
});

// ─── Coupons ──────────────────────────────────────────────────────────────────

// GET /admin/coupons?search=&isActive=&page=1&limit=10
router.get("/coupons", authenticateAdmin, getAllCoupons);

// GET /admin/coupons/stats
router.get("/coupons/stats", authenticateAdmin, getCouponStats);

// POST /admin/coupons
router.post("/coupons", authenticateAdmin, requireAdmin, createCoupon);

// GET /admin/coupons/:id
router.get("/coupons/:id", authenticateAdmin, getCoupon);

// PUT /admin/coupons/:id
router.put("/coupons/:id", authenticateAdmin, requireAdmin, updateCoupon);

// DELETE /admin/coupons/:id
router.delete("/coupons/:id", authenticateAdmin, requireAdmin, deleteCoupon);

// POST /admin/coupons/:id/reset-usage
router.post("/coupons/:id/reset-usage", authenticateAdmin, requireAdmin, resetCouponUsage);

// ─── Referrals ───────────────────────────────────────────────────────────────

// GET /admin/referrals/analytics - Overview stats
router.get("/referrals/analytics", authenticateAdmin, getReferralAnalytics);

// GET /admin/referrals/metrics - Distribution & metrics
router.get("/referrals/metrics", authenticateAdmin, getReferralMetrics);

// GET /admin/referrals - List all referrers with pagination
router.get("/referrals", authenticateAdmin, getReferralsList);

// GET /admin/referrals/:userId - Details for specific referrer
router.get("/referrals/:userId", authenticateAdmin, getReferrerDetails);

// ─── Email Campaigns ──────────────────────────────────────────────────────────

// GET /admin/campaigns - List all campaigns
router.get("/campaigns", authenticateAdmin, getAllCampaigns);

// POST /admin/campaigns - Create new campaign
router.post("/campaigns", authenticateAdmin, requireAdmin, createCampaign);

// GET /admin/campaigns/:id - Get single campaign
router.get("/campaigns/:id", authenticateAdmin, getCampaign);

// PUT /admin/campaigns/:id - Update campaign
router.put("/campaigns/:id", authenticateAdmin, requireAdmin, updateCampaign);

// DELETE /admin/campaigns/:id - Delete campaign
router.delete("/campaigns/:id", authenticateAdmin, requireAdmin, deleteCampaign);

// POST /admin/campaigns/:id/send - Send campaign immediately (admin + marketing)
router.post("/campaigns/:id/send", authenticateAdmin, sendCampaignNow);

// POST /admin/campaigns/:id/schedule - Schedule campaign for later (admin + marketing)
router.post("/campaigns/:id/schedule", authenticateAdmin, scheduleCampaign);

// POST /admin/campaigns/:id/pause - Pause running campaign (admin + marketing)
router.post("/campaigns/:id/pause", authenticateAdmin, pauseCampaign);

// POST /admin/campaigns/:id/resume - Resume paused campaign (admin + marketing)
router.post("/campaigns/:id/resume", authenticateAdmin, resumeCampaign);

// GET /admin/campaigns/:id/analytics - Get campaign metrics
router.get("/campaigns/:id/analytics", authenticateAdmin, getCampaignAnalytics);

// POST /admin/campaigns/estimate-segment - Preview segment size
router.post("/campaigns/estimate-segment", authenticateAdmin, estimateSegmentSize);

// GET /admin/campaigns/queue/stats - Get Bull queue stats
router.get("/campaigns/queue/stats", authenticateAdmin, getCampaignQueueStats);

// ─── Social Media Posts ────────────────────────────────────────────────────────

// POST /admin/social-posts/generate-copy - AI copy generation (before :id routes)
router.post("/social-posts/generate-copy", authenticateAdmin, generateSocialCopy);

// GET /admin/social-posts
router.get("/social-posts", authenticateAdmin, getAllSocialPosts);

// POST /admin/social-posts
router.post("/social-posts", authenticateAdmin, createSocialPost);

// GET /admin/social-posts/:id
router.get("/social-posts/:id", authenticateAdmin, getSocialPost);

// PUT /admin/social-posts/:id
router.put("/social-posts/:id", authenticateAdmin, updateSocialPost);

// DELETE /admin/social-posts/:id
router.delete("/social-posts/:id", authenticateAdmin, deleteSocialPost);

// POST /admin/social-posts/:id/publish - Send to Buffer (admin + marketing)
router.post("/social-posts/:id/publish", authenticateAdmin, publishToBuffer);

// ─── Image Upload (Cloudinary) ────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /admin/upload-image
router.post("/upload-image", authenticateAdmin, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded." });
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "technohana/social", resource_type: "image" },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(req.file.buffer);
    });
    return res.json({ url: result.secure_url });
  } catch (err) {
    console.error("Image upload error:", err);
    return res.status(500).json({ message: "Upload failed" });
  }
});

// ─── Instructors (Trainer Pool) ───────────────────────────────────────────────

// GET /admin/instructors/resume-proxy?url=<cloudinary_url>&disposition=inline|attachment
router.get("/instructors/resume-proxy", authenticateAdmin, async (req, res) => {
  const { url, disposition = "attachment" } = req.query;
  if (!url || !url.startsWith("https://res.cloudinary.com/dxudmbycn/")) {
    return res.status(400).json({ message: "Invalid URL" });
  }
  try {
    // Extract public_id from URL (strip base, version, and query string)
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(\?|$)/);
    if (!match) return res.status(400).json({ message: "Could not parse public_id" });
    const publicId = match[1];

    // Generate a signed URL valid for 5 minutes
    const signedUrl = cloudinary.utils.private_download_url(publicId, null, {
      resource_type: "raw",
      type: "upload",
      attachment: disposition === "attachment",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });

    return res.redirect(302, signedUrl);
  } catch (err) {
    console.error("Resume proxy error:", err);
    res.status(502).json({ message: "Failed to generate signed URL" });
  }
});

// GET /admin/instructors - List instructor applications
router.get("/instructors", authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const data = await Instructor.find(filter).sort({ submittedAt: -1 }).lean();
    return res.json({ data });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /admin/instructors/:id/status - Update instructor application status
router.patch("/instructors/:id/status", authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pending", "shortlisted", "rejected"].includes(status))
      return res.status(400).json({ message: "Invalid status." });
    const updated = await Instructor.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!updated) return res.status(404).json({ message: "Instructor not found." });
    return res.json({ data: updated });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /admin/enquiries/migrate-instructors
// Moves all Enquiries with enquiryType "Become Instructor" into the Instructor collection.
router.post("/enquiries/migrate-instructors", authenticateAdmin, async (req, res) => {
  try {
    const leads = await Enquiry.find({ enquiryType: "Become Instructor" }).lean();
    if (leads.length === 0) return res.json({ migrated: 0, skipped: 0 });

    const existingEmails = new Set(
      (await Instructor.find({ email: { $in: leads.map((l) => l.email) } }, "email").lean()).map((i) => i.email)
    );

    const toCreate = [];
    const toDeleteIds = [];

    for (const lead of leads) {
      if (existingEmails.has(lead.email)) continue;
      toCreate.push({
        name: lead.name,
        email: lead.email,
        phone: lead.phone || "",
        expertise: lead.expertise || "",
        experience: lead.experience || "",
        linkedinUrl: lead.linkedinUrl || "",
        coverLetter: lead.description || "",
        resumeUrl: "",
        resumePublicId: "",
        status: "pending",
        submittedAt: lead.createdAt || new Date(),
      });
      toDeleteIds.push(lead._id);
    }

    if (toCreate.length > 0) {
      await Instructor.insertMany(toCreate);
      await Enquiry.deleteMany({ _id: { $in: toDeleteIds } });
    }

    return res.json({ migrated: toCreate.length, skipped: leads.length - toCreate.length });
  } catch (err) {
    console.error("Migrate instructors error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
