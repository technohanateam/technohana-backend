import express from "express";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import axios from "axios";
import fs from "fs";
import path from "path";
import multer from "multer";
import xss from "xss";
import { v2 as cloudinary } from "cloudinary";
import { fileURLToPath } from "url";
import { buildRegexQuery } from "../utils/escapeRegex.js";
import { parseModelJson } from "../utils/parseModelJson.js";
import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import Enquiry from "../models/enquiry.model.js";
import Instructor from "../models/instructor.js";
import AiRiskReport from "../models/aiRiskReport.model.js";
import Testimonial from "../models/testimonial.model.js";
import Subscription from "../models/subscription.model.js";
import { Blogs } from "../models/blogs.model.js";
import Course from "../models/course.model.js";
import { CourseView } from "../models/courseView.model.js";
import { authenticateAdmin, requireAdmin, requireMarketing, requirePage } from "../middleware/authenticateAdmin.js";
import { adminLogin, setupAdmin, listAdminUsers, createAdminUser, updateAdminUser, resetAdminUserPassword, setAdminUserActive, forgotAdminPassword, resetAdminPasswordViaToken } from "../controllers/adminUser.controller.js";
import { getAllCoupons, getCoupon, createCoupon, updateCoupon, deleteCoupon, resetCouponUsage, getCouponStats } from "../controllers/coupon.controller.js";
import { quoteProposalLine, createProposal, updateProposal, getProposals, getProposal, deleteProposal } from "../controllers/proposal.controller.js";
import { getContacts, getContactProfile } from "../controllers/crm.controller.js";
import { getReferralAnalytics, getReferralsList, getReferrerDetails, getReferralMetrics } from "../controllers/admin-referral.controller.js";
import { getAllCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign, sendCampaignNow, scheduleCampaign, pauseCampaign, resumeCampaign, getCampaignAnalytics, estimateSegmentSize, getCampaignQueueStats, generateAICopy } from "../controllers/campaign.controller.js";
import { getAllDripSequences, getDripSequence, createDripSequence, updateDripSequence, deleteDripSequence, activateDripSequence, deactivateDripSequence } from "../controllers/dripSequence.controller.js";
import Campaign from "../models/campaign.model.js";
import Lead from "../models/lead.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { scoreEnquiry } from "../services/leadScoringAgent.js";
import TrainingRequirement from "../models/trainingRequirement.model.js";
import InstructorApplication from "../models/instructorApplication.model.js";
import { instructorSetPasswordEmail, newRequirementNotificationEmail, applicationStatusEmail, enrollmentApprovedEmail, enrollmentRejectedEmail } from "../utils/emailTemplate.js";
import crypto from "crypto";
import { generateResetToken, verifyResetToken } from "../utils/resetTokenUtil.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP address
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again after 15 minutes.',
});

// Throttles PII-bearing admin read endpoints (contacts, enquiries, leads, subscribers)
// keyed by admin id so one bulk-scraping token can't hammer the DB unbounded.
const adminDataLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.admin?.uid || req.ip,
  message: 'Too many requests. Please slow down.',
});

// Throttles AI-generation endpoints to prevent unbounded API cost from a single admin session.
const adminAiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.admin?.uid || req.ip,
  message: 'AI generation rate limit reached. Try again later.',
});

// Throttles Cloudinary uploads per admin to prevent quota abuse.
const adminUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.admin?.uid || req.ip,
  message: 'Upload rate limit reached. Try again later.',
});

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ─── POST /admin/login ────────────────────────────────────────────────────────
router.post("/login", adminLoginLimiter, adminLogin);

// ─── POST /admin/forgot-password / POST /admin/reset-password ────────────────
router.post("/forgot-password", adminLoginLimiter, forgotAdminPassword);
router.post("/reset-password", adminLoginLimiter, resetAdminPasswordViaToken);

// ─── POST /admin/setup — one-time bootstrap (disabled unless ALLOW_ADMIN_SETUP=true)
router.post("/setup", (req, res, next) => {
  if (process.env.ALLOW_ADMIN_SETUP !== "true") {
    return res.status(403).json({ success: false, message: "Setup endpoint is disabled. Set ALLOW_ADMIN_SETUP=true to enable." });
  }
  next();
}, setupAdmin);

// ─── Admin team user management (admin role only) ─────────────────────────────
router.get("/users", authenticateAdmin, requireAdmin, requirePage("team"), listAdminUsers);
router.post("/users", authenticateAdmin, requireAdmin, requirePage("team"), createAdminUser);
router.put("/users/:id", authenticateAdmin, requireAdmin, requirePage("team"), updateAdminUser);
router.patch("/users/:id/password", authenticateAdmin, requireAdmin, requirePage("team"), resetAdminUserPassword);
router.patch("/users/:id/active", authenticateAdmin, requireAdmin, requirePage("team"), setAdminUserActive);

// ─── All routes below require admin auth ──────────────────────────────────────

// GET /admin/stats
router.get("/stats", authenticateAdmin, requirePage("overview"), async (req, res) => {
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
      pendingInstructors,
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
      Instructor.countDocuments({ status: "pending" }),
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
      instructorApplications: { pending: pendingInstructors },
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/revenue-by-course — top courses by paid revenue (INR equivalent, top 10)
router.get("/revenue-by-course", authenticateAdmin, requirePage("overview", "sales-dashboard"), async (req, res) => {
  try {
    const rows = await Order.aggregate([
      { $match: { status: "paid" } },
      {
        $group: {
          _id: "$courseId",
          courseTitle: { $first: { $ifNull: ["$courseInfo.title", "$courseTitle"] } },
          totalMinor: { $sum: "$expectedTotalMinor" },
          currency: { $first: "$currency" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { totalMinor: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          courseId: "$_id",
          courseTitle: { $ifNull: ["$courseTitle", "$_id"] },
          totalMinor: 1,
          currency: 1,
          orders: 1,
        },
      },
    ]);
    return res.json({ rows });
  } catch (err) {
    console.error("Revenue by course error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/enrollments?status=&search=&page=1&limit=20
router.get("/enrollments", authenticateAdmin, requirePage("enrollments"), adminDataLimiter, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const safeLimit = Math.min(Number(limit) || 20, 200);
    const query = {};

    if (status) query.status = status;
    if (search) {
      const regex = buildRegexQuery(search);
      if (regex) {
        query.$or = [
          { name: regex },
          { email: regex },
          { courseTitle: regex },
        ];
      }
    }

    const skip = (Number(page) - 1) * safeLimit;
    const [data, total] = await Promise.all([
      User.find(query).sort({ _id: -1 }).skip(skip).limit(safeLimit).lean(),
      User.countDocuments(query),
    ]);

    return res.json({ success: true, data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Admin enrollments error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /admin/enrollments/:id/status
router.patch("/enrollments/:id/status", authenticateAdmin, requirePage("enrollments"), requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const { status, rejectionReason } = req.body;
    const allowed = ["pending-payment", "in-progress", "enrolled", "rejected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    const updateFields = {
      status,
      statusChangedBy: req.admin?.uid || req.admin?.email || null,
      statusChangedAt: new Date(),
    };
    if (status === "rejected" && rejectionReason) {
      updateFields.rejectionReason = rejectionReason;
    }

    const update = status === "rejected"
      ? updateFields
      : { ...updateFields, $unset: { rejectionReason: "" } };

    const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ message: "Enrollment not found." });

    // Send email notification to learner
    if (updated.email) {
      try {
        if (status === "enrolled") {
          await sendEmail({
            to: updated.email,
            subject: "You're enrolled — Welcome to Technohana!",
            html: enrollmentApprovedEmail({ name: updated.name, courseTitle: updated.courseTitle }),
          });
        } else if (status === "rejected") {
          await sendEmail({
            to: updated.email,
            subject: "Update on your Technohana enrollment",
            html: enrollmentRejectedEmail({ name: updated.name, courseTitle: updated.courseTitle, reason: rejectionReason }),
          });
        }
      } catch (emailErr) {
        console.error("Enrollment status email failed:", emailErr.message);
      }
    }

    return res.json({ data: updated });
  } catch (err) {
    console.error("Admin update status error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/enrollments/:id
router.delete("/enrollments/:id", authenticateAdmin, requirePage("enrollments"), requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Enrollment not found." });
    return res.json({ message: "Enrollment deleted.", data: deleted });
  } catch (err) {
    console.error("Admin delete enrollment error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/enquiries?page=1&limit=20&search=&status=&enquiryType=
router.get("/enquiries", authenticateAdmin, requirePage("enquiries", "sales-pipeline"), adminDataLimiter, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status, enquiryType } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter = {};
    if (search) {
      const regex = buildRegexQuery(search);
      if (regex) {
        filter.$or = [
          { name: regex },
          { email: regex },
          { phone: regex },
          { courseTitle: regex },
          { enquiryType: regex },
        ];
      }
    }
    if (status && status !== "All Statuses") filter.status = status;
    if (enquiryType && enquiryType !== "All Types") filter.enquiryType = enquiryType;
    const [data, total] = await Promise.all([
      Enquiry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Enquiry.countDocuments(filter),
    ]);
    return res.json({ success: true, data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Admin enquiries error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/enquiries/ranked — open leads sorted by AI score
router.get("/enquiries/ranked", authenticateAdmin, requirePage("enquiries", "sales-pipeline"), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const data = await Enquiry.find({ status: { $in: ["new", "contacted"] } })
      .sort({ aiScore: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ success: true, data });
  } catch (err) {
    console.error("Admin ranked enquiries error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /admin/enquiries/:id — fetch a single enquiry with its activities
router.get("/enquiries/:id", authenticateAdmin, requirePage("enquiries", "sales-pipeline"), async (req, res) => {
  try {
    const enquiry = await Enquiry.findById(req.params.id).lean();
    if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found" });
    return res.json({ success: true, data: enquiry, message: "Enquiry loaded" });
  } catch (err) {
    console.error("Admin get enquiry error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /admin/enquiries/:id/rescore — re-run AI lead scoring
router.post("/enquiries/:id/rescore", authenticateAdmin, requirePage("enquiries", "sales-pipeline"), adminAiLimiter, async (req, res) => {
  try {
    const scored = await scoreEnquiry(req.params.id);
    if (!scored) return res.status(422).json({ success: false, message: "Scoring failed. Ensure the enquiry exists and AI scoring is enabled." });
    return res.json({ success: true, data: scored, message: "Enquiry rescored." });
  } catch (err) {
    console.error("Admin rescore enquiry error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /admin/enquiries/clear
router.delete("/enquiries/clear", authenticateAdmin, requirePage("enquiries", "sales-pipeline"), requireAdmin, async (req, res) => {
  try {
    if (req.body?.confirm !== "DELETE ALL") {
      return res.status(400).json({ success: false, message: "Pass { confirm: 'DELETE ALL' } in the request body to confirm bulk deletion." });
    }
    const result = await Enquiry.deleteMany({});
    return res.json({ success: true, message: "Cleared all enquiries", deleted: result.deletedCount });
  } catch (err) {
    console.error("Admin clear enquiries error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /admin/enquiries/:id
router.delete("/enquiries/:id", authenticateAdmin, requirePage("enquiries", "sales-pipeline"), requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const deleted = await Enquiry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Enquiry not found." });
    return res.json({ message: "Enquiry deleted." });
  } catch (err) {
    console.error("Admin delete enquiry error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /admin/enquiries/:id — update status, notes, assignedTo, nextFollowUp, lostReason
router.patch("/enquiries/:id", authenticateAdmin, requirePage("enquiries", "sales-pipeline"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
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

// GET /admin/hot-courses?limit=5 — top N courses by enquiry count (server-side aggregation)
router.get("/hot-courses", authenticateAdmin, requirePage("sales-dashboard", "sales-pipeline"), adminDataLimiter, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const results = await Enquiry.aggregate([
      { $match: { courseTitle: { $exists: true, $ne: null, $ne: "" } } },
      { $group: { _id: "$courseTitle", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
      { $project: { _id: 0, courseTitle: "$_id", count: 1 } },
    ]);
    return res.json({ data: results });
  } catch (err) {
    console.error("Hot courses error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/pipeline-stats — stage breakdown, stale counts, win rate, follow-up due today
router.get("/pipeline-stats", authenticateAdmin, requirePage("sales-pipeline", "sales-dashboard"), async (req, res) => {
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

// GET /admin/testimonials?page=1&limit=20&status=pending&serviceType=training
router.get("/testimonials", authenticateAdmin, requirePage("testimonials"), async (req, res) => {
  try {
    const { page = 1, limit = 20, status, serviceType } = req.query;
    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (serviceType && serviceType !== "all") filter.serviceType = serviceType;
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
router.patch("/testimonials/:id", authenticateAdmin, requirePage("testimonials"), requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid testimonial ID." });
    }
    const { status } = req.body;
    const VALID_STATUSES = ["pending", "approved", "rejected"];
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }
    const updated = await Testimonial.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: "Testimonial not found." });
    return res.json(updated);
  } catch (err) {
    console.error("Admin patch testimonial error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/testimonials/:id
router.delete("/testimonials/:id", authenticateAdmin, requirePage("testimonials"), async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid testimonial ID." });
    }
    const deleted = await Testimonial.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Testimonial not found." });
    return res.json({ message: "Testimonial deleted." });
  } catch (err) {
    console.error("Admin delete testimonial error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/ai-risk-reports?page=1&limit=20
router.get("/ai-risk-reports", authenticateAdmin, requirePage("ai-risk-reports"), async (req, res) => {
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
router.delete("/ai-risk-reports/clear", authenticateAdmin, requirePage("ai-risk-reports"), requireAdmin, async (req, res) => {
  try {
    const { deletedCount } = await AiRiskReport.deleteMany({});
    return res.json({ message: "Cleared all AI risk reports", deleted: deletedCount });
  } catch (err) {
    console.error("Clear AI risk reports error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/ai-risk-reports/:id
router.delete("/ai-risk-reports/:id", authenticateAdmin, requirePage("ai-risk-reports"), requireAdmin, async (req, res) => {
  try {
    const result = await AiRiskReport.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ message: "Not found" });
    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error("Delete AI risk report error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/leads?page=1&limit=20&persona=executives
router.get("/leads", authenticateAdmin, requirePage("crm"), adminDataLimiter, async (req, res) => {
  try {
    const { page = 1, limit = 20, persona } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter = persona ? { persona } : {};
    const [data, total] = await Promise.all([
      Lead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Lead.countDocuments(filter),
    ]);
    return res.json({ success: true, data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Admin leads error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/subscribers?page=1&limit=20
router.get("/subscribers", authenticateAdmin, requirePage("subscribers"), adminDataLimiter, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      Subscription.find().sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Subscription.countDocuments(),
    ]);
    return res.json({ success: true, data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Admin subscribers error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /admin/blogs
router.get("/blogs", authenticateAdmin, requirePage("blogs"), async (req, res) => {
  try {
    const data = await Blogs.find().sort({ _id: -1 }).lean();
    return res.json({ data });
  } catch (err) {
    console.error("Admin blogs error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /admin/blogs
router.post("/blogs", authenticateAdmin, requirePage("blogs"), requireAdmin, async (req, res) => {
  try {
    const { title, slug, img, author, date, content, category, excerpt, metaTitle, metaDescription, focusKeyword, tags, readTimeMin, sources, faqs } = req.body;
    if (!title) return res.status(400).json({ message: "Title is required." });

    const lastBlog = await Blogs.findOne().sort({ id: -1 }).lean();
    const nextId = lastBlog ? (lastBlog.id || 0) + 1 : 1;

    const generatedSlug =
      slug ||
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    const existing = await Blogs.findOne({ slug: generatedSlug });
    if (existing) return res.status(409).json({ message: "A blog with this slug already exists." });

    const blog = new Blogs({
      id: nextId,
      title,
      slug: generatedSlug,
      img: img || "",
      author: author || "",
      date: date || new Date().toISOString().split("T")[0],
      content: sanitizeContent(content) || "",
      category: category || "",
      excerpt: excerpt || "",
      metaTitle: metaTitle || "",
      metaDescription: metaDescription || "",
      focusKeyword: focusKeyword || "",
      tags: tags || [],
      readTimeMin: readTimeMin || null,
      sources: sources || [],
      faqs: faqs || [],
    });
    await blog.save();
    return res.status(201).json({ data: blog });
  } catch (err) {
    console.error("Admin create blog error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PUT /admin/blogs/:id
router.put("/blogs/:id", authenticateAdmin, requirePage("blogs"), requireMarketing, async (req, res) => {
  try {
    const { title, slug, img, author, date, content, category, excerpt, metaTitle, metaDescription, focusKeyword, tags, readTimeMin, sources, faqs } = req.body;
    const updated = await Blogs.findByIdAndUpdate(
      req.params.id,
      { title, slug, img, author, date, content: sanitizeContent(content), category, excerpt, metaTitle, metaDescription, focusKeyword, tags, readTimeMin, sources, faqs },
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
router.delete("/blogs/:id", authenticateAdmin, requirePage("blogs"), requireAdmin, async (req, res) => {
  try {
    const deleted = await Blogs.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Blog not found." });
    return res.json({ message: "Blog deleted." });
  } catch (err) {
    console.error("Admin delete blog error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /admin/blogs/:id/publish — toggle published status (or schedule)
router.patch("/blogs/:id/publish", authenticateAdmin, requirePage("blogs"), requireMarketing, async (req, res) => {
  try {
    const { published, scheduledAt } = req.body;
    const blog = await Blogs.findById(req.params.id);
    if (!blog) return res.status(404).json({ message: "Blog not found." });
    blog.published = typeof published === "boolean" ? published : !blog.published;
    blog.scheduledAt = scheduledAt !== undefined ? (scheduledAt ? new Date(scheduledAt) : null) : blog.scheduledAt;
    await blog.save();
    return res.json({ published: blog.published, scheduledAt: blog.scheduledAt });
  } catch (err) {
    console.error("Admin toggle publish error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /admin/blogs/seed-static — bulk import static blog posts, skip existing slugs
router.post("/blogs/seed-static", authenticateAdmin, requirePage("blogs"), requireAdmin, async (req, res) => {
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
// Uses Claude's built-in web_search tool so no external search API key is needed.
// Claude searches the web autonomously, then writes the post grounded in current data.
router.post("/blogs/generate-from-course", authenticateAdmin, requirePage("blogs"), requireAdmin, adminAiLimiter, async (req, res) => {
  try {
    const { courseId, courseTitle, category, description, relatedCourses = [] } = req.body;
    if (!courseTitle) return res.status(400).json({ message: "courseTitle is required." });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ success: false, message: "AI generation not configured. Add ANTHROPIC_API_KEY to .env" });

    const year = new Date().getFullYear();

    const sanitize = (str) => String(str || "").replace(/[`${}]/g, "");
    const relatedCoursesBullets = Array.isArray(relatedCourses) && relatedCourses.length
      ? relatedCourses.map(c => `  • <a href="/courses/${sanitize(c.id)}">${sanitize(c.title)}</a>`).join("\n")
      : "  (none — use only the main course link above)";

    const systemPrompt = `You are Technohana's Senior SEO Content Strategist and Technical Writer.

Your goal is to produce authoritative, accurate, search-optimized technical blog articles that rank well on search engines while genuinely helping readers.

You have access to a web search tool.

Before writing:
1. Search for recent information.
2. Verify facts.
3. Use only information supported by search results.
4. Never invent statistics, rankings, salaries, certifications, trends, company statements, or URLs.

Writing style:
• Professional and educational
• Clear and concise
• Technical where appropriate
• Written for professionals, students, developers and decision makers
• Avoid marketing hype
• Avoid exaggerated claims
• Never use emojis
• Use short paragraphs
• Prefer bullet lists where useful
• Explain technical concepts simply

SEO Requirements:
• Naturally use the focus keyword.
• Include it in the title, first paragraph, one H2, and conclusion.
• Write compelling metadata.
• Avoid keyword stuffing.
• Create human-first content.

HTML Requirements:
Only return HTML inside the content field.
Allowed tags: <p> <h2> <h3> <ul> <ol> <li> <strong> <em> <a>
Never use inline CSS.
Internal links must be naturally integrated into relevant sentences.
External links should never be inserted into the HTML. Only list them in sources.
If a fact cannot be verified from search results, omit it.

Return ONLY valid JSON. No markdown. No explanations.`;

    const userPrompt = `Create a long-form SEO blog post for Technohana.

Course
Title: ${courseTitle}
Year: ${year}
${description ? `Description: ${description}` : ""}

Search the web before writing. Perform searches similar to:
- "${courseTitle} trends ${year}"
- "${courseTitle} jobs salary demand ${year}"
- "${courseTitle} certifications ${year}"
- "${courseTitle} enterprise adoption ${year}"

After collecting information, create a blog with these requirements.

Requirements
Length: 700–1200 words
Structure: Introduction, 4–5 H2 sections, Conclusion, 3–5 FAQs
Tone: Educational, Objective, Actionable, Trustworthy
Use examples where appropriate.
Never fabricate statistics. If statistics are unavailable, discuss trends qualitatively.

Internal links — naturally include these in the article:
Primary Course: <a href="/courses/${courseId}">${courseTitle}</a>
Related Courses:
${relatedCoursesBullets}
Blog: <a href="/blog/">the Technohana blog</a>

Do NOT create a "Recommended Courses" section. Integrate links naturally into paragraphs.

SEO — generate: title, slug, excerpt, meta title (50–60 chars), meta description (140–160 chars), focus keyword, tags, read time, author, category.

Return ONLY this JSON object:
{"title":"","slug":"","excerpt":"","content":"","metaTitle":"","metaDescription":"","focusKeyword":"","tags":[],"readTimeMin":0,"author":"","category":"","sources":[],"faqs":[{"question":"","answer":""}]}

Sources: only URLs returned by web search. Never invent URLs.`;

    // Agentic loop: Claude may call web_search multiple times before producing the final text
    const messages = [{ role: "user", content: userPrompt }];
    const tools = [{ type: "web_search_20260209", name: "web_search" }];
    let finalText = "";

    for (let turn = 0; turn < 5; turn++) {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-sonnet-5",
          max_tokens: 8192,
          system: systemPrompt,
          tools,
          messages,
        },
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          timeout: 120000,
        }
      );

      const { stop_reason, content } = response.data;

      // Append assistant turn to message history (includes embedded search results
      // for built-in tools like web_search_20260209 — the API handles these server-side)
      messages.push({ role: "assistant", content });

      if (stop_reason === "end_turn") {
        // Claude is done — extract the final text block
        const textBlock = content.find(b => b.type === "text");
        finalText = textBlock?.text?.trim() || "";
        break;
      }

      if (stop_reason === "tool_use") {
        // For Anthropic built-in tools (web_search_20260209), search results are
        // already embedded in the response content by the API. Just continue —
        // do NOT fabricate tool_result blocks.
        continue;
      }

      // Any other stop reason — bail out
      break;
    }

    if (!finalText) return res.status(500).json({ message: "Claude did not produce a final response." });

    let generated;
    try {
      generated = parseModelJson(finalText);
    } catch {
      generated = null;
    }
    if (!generated) {
      console.error("generate-from-course: failed to parse AI response. Raw:", finalText?.slice(0, 500));
      return res.status(500).json({ success: false, message: "Failed to parse AI response. Please try again." });
    }
    return res.json({ success: true, data: generated });
  } catch (err) {
    console.error("Blog generation error:", err?.response?.data?.error?.message || err.message);
    return res.status(500).json({ success: false, message: "Failed to generate blog." });
  }
});

// POST /admin/blogs/generate-from-urls — AI-generate a blog post from live URLs
router.post("/blogs/generate-from-urls", authenticateAdmin, requirePage("blogs"), requireAdmin, adminAiLimiter, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ success: false, message: "ANTHROPIC_API_KEY not configured." });

  const { urls, topic, category, focusKeyword, relatedCourses = [] } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ success: false, message: "Provide at least one URL." });
  }
  if (urls.length > 5) {
    return res.status(400).json({ success: false, message: "Maximum 5 URLs allowed." });
  }

  // Block requests to internal/private IP ranges to prevent SSRF
  const SSRF_BLOCKED_PATTERNS = [
    /^https?:\/\/169\.254\./,
    /^https?:\/\/10\./,
    /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
    /^https?:\/\/192\.168\./,
    /^https?:\/\/127\./,
    /^https?:\/\/\[::1\]/,
    /^https?:\/\/localhost/i,
  ];
  const isSsrfBlocked = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
      return SSRF_BLOCKED_PATTERNS.some((re) => re.test(url));
    } catch { return true; }
  };
  if (urls.some(isSsrfBlocked)) {
    return res.status(400).json({ success: false, message: "One or more URLs are not allowed." });
  }

  // Fetch and extract plain text from each URL (server-side)
  const stripHtml = (html) => html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();

  const sourceSections = [];
  const sourcesList = [];
  const failedUrls = [];
  for (const url of urls) {
    try {
      const pageRes = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TechnohanaBot/1.0)" }, signal: AbortSignal.timeout(12000) });
      // fetch() only throws on network-level failures, not HTTP error statuses —
      // without this check a 404/500 page's own title (e.g. "Page Not Found")
      // would get cited as a legitimate source.
      if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);
      const html = await pageRes.text();
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const text = stripHtml(html).slice(0, 3000);
      sourceSections.push(`--- SOURCE: ${url} ---\n${text}`);
      sourcesList.push({ title: titleMatch ? stripHtml(titleMatch[1]).trim() : url, url });
    } catch {
      failedUrls.push(url);
      sourceSections.push(`--- SOURCE: ${url} ---\n[Could not fetch this URL]`);
    }
  }

  const year = new Date().getFullYear();
  const topicLine = topic || "Determine the best topic from the source material.";
  const categoryLine = category || "";
  const keywordLine = focusKeyword || "";

  const sanitize = (str) => String(str || "").replace(/[`${}]/g, "");
  const relatedCoursesBullets = Array.isArray(relatedCourses) && relatedCourses.length
    ? relatedCourses.map(c => `  • <a href="/courses/${sanitize(c.id)}">${sanitize(c.title)}</a>`).join("\n")
    : "";
  const courseLinkInstruction = relatedCoursesBullets
    ? `conclusion with a call-to-action linking to <a href="https://technohana.in/courses">Technohana courses</a>. Also include internal links within the body prose (not in a separate list at the end): where topically relevant, link inline to 2–3 of these related Technohana courses using their exact URLs — do NOT invent a course or id that isn't in this list:\n${relatedCoursesBullets}\n  Do NOT add a standalone "Recommended Courses" section — all links must appear inside paragraph or list content`
    : `conclusion with a call-to-action linking to <a href="https://technohana.in/courses">Technohana courses</a>`;

  const systemPromptUrls = `You are Technohana's Senior Technical Content Writer.

You are given extracted content from trusted web pages.

Treat this content as your only factual source.

Rules:
Never invent facts.
Never invent statistics.
Never reference websites that are not included.
Never claim to have searched the web.
Summarize, synthesize and explain the provided material in your own words.
Write a high-quality SEO article.
Avoid copying long passages.
Return only valid JSON.`;

  const userPrompt = `Write a technical SEO blog using the source material below.

Topic: ${topicLine}
Category: ${categoryLine}
Preferred focus keyword: ${keywordLine}

Source Material:
${sourceSections.join("\n\n")}

Requirements:
700–1200 words
Introduction, 4–5 H2 sections, Conclusion, 3–5 FAQs
Short paragraphs. Use bullet points where useful.
Professional tone. Educational.
Do not mention that the content came from supplied sources.

Internal links — naturally include:
${courseLinkInstruction}

Return this JSON only:
{"title":"","slug":"","excerpt":"","content":"","metaTitle":"","metaDescription":"","focusKeyword":"","tags":[],"readTimeMin":0,"author":"","category":"","faqs":[]}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8192,
        system: systemPromptUrls,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(120000),
    });

    const data = await response.json();
    const finalText = data.content?.find((b) => b.type === "text")?.text || "";
    let generated;
    try {
      generated = parseModelJson(finalText);
    } catch {
      generated = null;
    }
    if (!generated) {
      console.error("generate-from-urls: failed to parse AI response. Raw:", finalText?.slice(0, 500));
      return res.status(500).json({ success: false, message: "Failed to parse AI response. Please try again." });
    }
    // sources are deterministic from the input URLs (with titles fetched server-side)
    // rather than trusted to the model, which could otherwise invent or drop entries.
    generated.sources = sourcesList;
    return res.json({
      success: true,
      data: generated,
      ...(failedUrls.length ? { warnings: failedUrls } : {}),
    });
  } catch (err) {
    console.error("Blog generate-from-urls error:", err?.message);
    return res.status(500).json({ success: false, message: "Failed to generate blog from URLs." });
  }
});

// POST /admin/blogs/rewrite — AI-rewrite and improve an existing blog post
router.post("/blogs/rewrite", authenticateAdmin, requirePage("blogs"), requireAdmin, adminAiLimiter, async (req, res) => {
  try {
    const { title, content, excerpt, category, focusKeyword, author, sources, faqs } = req.body;
    if (!title || !content) return res.status(400).json({ message: "title and content are required." });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ success: false, message: "AI rewrite not configured. Add ANTHROPIC_API_KEY to .env" });

    const rewriteSystemPrompt = `You are Technohana's Senior Content Editor.

Your job is to improve existing articles without changing their intent.

Preserve factual accuracy.
Do not invent facts.
Do not invent statistics.
Do not remove important information.

Improve: SEO, readability, flow, technical accuracy, paragraph structure, internal linking.
Keep HTML valid.
Return only JSON.`;

    const prompt = `Rewrite the following blog.

Title: ${title}
Excerpt: ${excerpt || ""}
Category: ${category || "Technology"}
Focus keyword: ${focusKeyword || ""}

Content:
${content}

Requirements:
Minimum 700 words.
Improve SEO. Naturally place the focus keyword in: title, first paragraph, one H2, conclusion.
Shorten long paragraphs. Improve transitions. Add practical examples. Expand explanations.
Include exactly two internal links: <a href="/courses/">Technohana courses</a> and <a href="/blog/">related blog posts</a>.
Do not remove existing meaning. Do not modify FAQs. Do not modify sources.

Return only:
{"title":"","slug":"","excerpt":"","content":"","metaTitle":"","metaDescription":"","focusKeyword":"","tags":[],"readTimeMin":0,"author":"${author || "Technohana Team"}","category":"${category || "Technology"}"}`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-5",
        max_tokens: 8192,
        system: rewriteSystemPrompt,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        timeout: 120000,
      }
    );

    const raw = response.data.content?.[0]?.text?.trim() || "";
    let generated;
    try {
      generated = parseModelJson(raw);
    } catch {
      generated = null;
    }
    if (!generated) {
      console.error("blogs/rewrite: failed to parse AI response. Raw:", raw?.slice(0, 500));
      return res.status(500).json({ success: false, message: "Failed to parse AI response. Please try again." });
    }
    // Rewrite only touches prose/SEO fields — carry the original post's
    // sources and FAQs through unchanged rather than asking the model to
    // reproduce them (which risks silent drift or invented entries).
    generated.sources = sources || [];
    generated.faqs = faqs || [];
    return res.json({ success: true, data: generated });
  } catch (err) {
    console.error("Blog rewrite error:", err?.response?.data?.error?.message || err.message);
    return res.status(500).json({ success: false, message: "Failed to rewrite blog." });
  }
});

// POST /admin/blogs/bulk-publish — set published status on multiple blogs at once
router.post("/blogs/bulk-publish", authenticateAdmin, requirePage("blogs"), requireMarketing, async (req, res) => {
  try {
    const { ids, published } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids array is required." });
    if (typeof published !== "boolean") return res.status(400).json({ message: "published must be a boolean." });
    const result = await Blogs.updateMany({ _id: { $in: ids } }, { $set: { published } });
    return res.json({ success: true, updated: result.modifiedCount });
  } catch (err) {
    console.error("Bulk publish error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /admin/blogs/bulk-delete — delete multiple blogs at once
router.post("/blogs/bulk-delete", authenticateAdmin, requirePage("blogs"), requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids array is required." });
    const result = await Blogs.deleteMany({ _id: { $in: ids } });
    return res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    console.error("Bulk delete error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /admin/blogs/auto-seo — AI-fill SEO fields for a single blog
router.post("/blogs/auto-seo", authenticateAdmin, requirePage("blogs"), requireMarketing, adminAiLimiter, async (req, res) => {
  try {
    const { _id, title, content, category } = req.body;
    if (!_id || !title) return res.status(400).json({ message: "_id and title are required." });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ success: false, message: "ANTHROPIC_API_KEY not configured." });

    const plainText = (content || "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<\/?[^>]+(>|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);

    const seoSystemPrompt = `You are an SEO metadata optimization assistant.
Generate concise metadata from article content.
Never invent topics not present.
Keep titles readable.
Avoid clickbait.
Return only JSON.`;

    const prompt = `Article:
${plainText}

Generate:
Meta title — 50–60 characters
Meta description — 140–160 characters
Excerpt — 40–70 words
Focus keyword — one primary keyword only

Return only:
{"metaTitle":"","metaDescription":"","excerpt":"","focusKeyword":""}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: seoSystemPrompt,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    const data = await response.json();
    const raw = data.content?.find((b) => b.type === "text")?.text?.trim() || "";
    let seoFields;
    try {
      seoFields = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      seoFields = match ? JSON.parse(match[0]) : null;
    }
    if (!seoFields) return res.status(500).json({ message: "Failed to parse AI SEO response.", raw });

    const updated = await Blogs.findByIdAndUpdate(
      _id,
      { $set: { metaTitle: seoFields.metaTitle || "", metaDescription: seoFields.metaDescription || "", excerpt: seoFields.excerpt || "", focusKeyword: seoFields.focusKeyword || "" } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Blog not found." });
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Auto-SEO error:", err);
    return res.status(500).json({ message: "Failed to generate SEO fields.", detail: err.message });
  }
});

// POST /admin/blogs/auto-schedule — spread draft blogs across upcoming dates
router.post("/blogs/auto-schedule", authenticateAdmin, requirePage("blogs"), requireMarketing, async (req, res) => {
  try {
    const { startDate, intervalDays } = req.body;
    if (!startDate) return res.status(400).json({ message: "startDate is required." });
    const interval = parseInt(intervalDays, 10) || 7;
    if (!interval || interval < 1 || interval > 365) return res.status(400).json({ message: "intervalDays must be between 1 and 365." });

    const drafts = await Blogs.find({ published: false }).sort({ _id: 1 }).lean();
    if (drafts.length === 0) return res.json({ success: true, scheduled: 0, dates: [] });

    const base = new Date(startDate);
    const bulkOps = drafts.map((blog, i) => {
      const scheduledAt = new Date(base.getTime() + i * interval * 24 * 60 * 60 * 1000);
      return {
        updateOne: {
          filter: { _id: blog._id },
          update: { $set: { published: true, scheduledAt } },
        },
      };
    });

    await Blogs.bulkWrite(bulkOps);
    const dates = drafts.map((_, i) => new Date(base.getTime() + i * interval * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);
    return res.json({ success: true, scheduled: drafts.length, dates });
  } catch (err) {
    console.error("Auto-schedule error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ─── Courses ──────────────────────────────────────────────────────────────────

// GET /admin/courses?category=&search=&page=1&limit=20
router.get("/courses", authenticateAdmin, requirePage("courses", "quote-generator", "proposal-builder"), async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;
    const query = {};
    if (category) query.category = category;
    if (search) {
      const regex = buildRegexQuery(search);
      if (regex) {
        query.$or = [
          { courseTitle: regex },
          { instructor: regex },
          { id: regex },
        ];
      }
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

const ALLOWED_COURSE_FIELDS = [
  "id", "courseTitle", "courseSlug", "category", "difficulty", "price", "prices",
  "instructor", "instructorId", "language", "courseDays", "courseTime", "courseModules",
  "noStudents", "rating", "logo", "toc", "videoId", "catcls", "overview",
  "courseObjective", "courseOutcomes", "labs", "prerequisites", "whatWillYouLearn",
  "requirements", "targetAudience", "modules", "categoryGroup",
];
const pickCourseFields = (body) =>
  Object.fromEntries(ALLOWED_COURSE_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]));

// POST /admin/courses
router.post("/courses", authenticateAdmin, requirePage("courses", "quote-generator", "proposal-builder"), requireAdmin, async (req, res) => {
  try {
    const { courseTitle } = req.body;
    if (!courseTitle) return res.status(400).json({ message: "courseTitle is required." });

    const course = new Course(pickCourseFields(req.body));
    await course.save();
    return res.status(201).json({ data: course });
  } catch (err) {
    console.error("Admin create course error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PUT /admin/courses/:id
router.put("/courses/:id", authenticateAdmin, requirePage("courses", "quote-generator", "proposal-builder"), requireAdmin, async (req, res) => {
  try {
    const updated = await Course.findByIdAndUpdate(req.params.id, pickCourseFields(req.body), { new: true });
    if (!updated) return res.status(404).json({ message: "Course not found." });
    return res.json({ data: updated });
  } catch (err) {
    console.error("Admin update course error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/courses/:id
router.delete("/courses/:id", authenticateAdmin, requirePage("courses", "quote-generator", "proposal-builder"), requireAdmin, async (req, res) => {
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
router.delete("/courses/clear", authenticateAdmin, requirePage("courses", "quote-generator", "proposal-builder"), requireAdmin, async (req, res) => {
  try {
    const result = await Course.deleteMany({});
    return res.json({ message: "Cleared all courses", deleted: result.deletedCount });
  } catch (err) {
    console.error("Admin clear courses error:", err);
    return res.status(500).json({ message: "Server error", detail: err.message });
  }
});

// POST /admin/courses/seed — sync from src/data/courses.json
// force=true: upsert all (updates existing courses including prices)
// force=false (default): additive only (insert missing courses)
router.post("/courses/seed", authenticateAdmin, requirePage("courses", "quote-generator", "proposal-builder"), requireAdmin, async (req, res) => {
  try {
    const { force } = req.body || {};
    const dataPath = path.join(__dirname, "../data/courses.json");
    const raw = fs.readFileSync(dataPath, "utf-8");
    const courses = JSON.parse(raw);

    if (force) {
      const ops = courses
        .filter(c => c.id)
        .map(c => ({
          updateOne: {
            filter: { id: c.id },
            update: { $set: c },
            upsert: true,
          },
        }));
      const result = await Course.bulkWrite(ops, { ordered: false });
      const total = await Course.countDocuments();
      return res.json({
        message: `Reseeded ${ops.length} courses (upsert)`,
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
        total,
      });
    }

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
router.get("/coupons", authenticateAdmin, requirePage("coupons"), getAllCoupons);

// GET /admin/coupons/stats
router.get("/coupons/stats", authenticateAdmin, requirePage("coupons"), getCouponStats);

// POST /admin/coupons
router.post("/coupons", authenticateAdmin, requirePage("coupons"), requireAdmin, createCoupon);

// GET /admin/coupons/:id
router.get("/coupons/:id", authenticateAdmin, requirePage("coupons"), getCoupon);

// PUT /admin/coupons/:id
router.put("/coupons/:id", authenticateAdmin, requirePage("coupons"), requireAdmin, updateCoupon);

// DELETE /admin/coupons/:id
router.delete("/coupons/:id", authenticateAdmin, requirePage("coupons"), requireAdmin, deleteCoupon);

// POST /admin/coupons/:id/reset-usage
router.post("/coupons/:id/reset-usage", authenticateAdmin, requirePage("coupons"), requireAdmin, resetCouponUsage);

// ─── Referrals ───────────────────────────────────────────────────────────────

// GET /admin/referrals/analytics - Overview stats
router.get("/referrals/analytics", authenticateAdmin, requirePage("referrals"), getReferralAnalytics);

// GET /admin/referrals/metrics - Distribution & metrics
router.get("/referrals/metrics", authenticateAdmin, requirePage("referrals"), getReferralMetrics);

// GET /admin/referrals - List all referrers with pagination
router.get("/referrals", authenticateAdmin, requirePage("referrals"), getReferralsList);

// GET /admin/referrals/:userId - Details for specific referrer
router.get("/referrals/:userId", authenticateAdmin, requirePage("referrals"), getReferrerDetails);

// ─── Email Campaigns ──────────────────────────────────────────────────────────

// GET /admin/campaigns - List all campaigns
router.get("/campaigns", authenticateAdmin, requirePage("campaigns", "marketing-overview"), getAllCampaigns);

// POST /admin/campaigns - Create new campaign
router.post("/campaigns", authenticateAdmin, requirePage("campaigns", "marketing-overview"), requireAdmin, createCampaign);

// GET /admin/campaigns/:id - Get single campaign
router.get("/campaigns/:id", authenticateAdmin, requirePage("campaigns", "marketing-overview"), getCampaign);

// PUT /admin/campaigns/:id - Update campaign
router.put("/campaigns/:id", authenticateAdmin, requirePage("campaigns", "marketing-overview"), requireAdmin, updateCampaign);

// DELETE /admin/campaigns/:id - Delete campaign
router.delete("/campaigns/:id", authenticateAdmin, requirePage("campaigns", "marketing-overview"), requireAdmin, deleteCampaign);

// POST /admin/campaigns/:id/send - Send campaign immediately (admin + marketing)
router.post("/campaigns/:id/send", authenticateAdmin, requirePage("campaigns", "marketing-overview"), requireMarketing, sendCampaignNow);

// POST /admin/campaigns/:id/schedule - Schedule campaign for later (admin + marketing)
router.post("/campaigns/:id/schedule", authenticateAdmin, requirePage("campaigns", "marketing-overview"), requireMarketing, scheduleCampaign);

// POST /admin/campaigns/:id/pause - Pause running campaign (admin + marketing)
router.post("/campaigns/:id/pause", authenticateAdmin, requirePage("campaigns", "marketing-overview"), requireMarketing, pauseCampaign);

// POST /admin/campaigns/:id/resume - Resume paused campaign (admin + marketing)
router.post("/campaigns/:id/resume", authenticateAdmin, requirePage("campaigns", "marketing-overview"), requireMarketing, resumeCampaign);

// GET /admin/campaigns/:id/analytics - Get campaign metrics
router.get("/campaigns/:id/analytics", authenticateAdmin, requirePage("campaigns", "marketing-overview"), getCampaignAnalytics);

// POST /admin/campaigns/estimate-segment - Preview segment size
router.post("/campaigns/estimate-segment", authenticateAdmin, requirePage("campaigns", "marketing-overview"), estimateSegmentSize);

// GET /admin/campaigns/queue/stats - Get Bull queue stats
router.get("/campaigns/queue/stats", authenticateAdmin, requirePage("campaigns", "marketing-overview"), getCampaignQueueStats);

// POST /admin/campaigns/:id/ai-copy - Generate AI copy for a campaign
router.post("/campaigns/:id/ai-copy", authenticateAdmin, requirePage("campaigns", "marketing-overview"), requireMarketing, generateAICopy);

// ─── Drip Sequences ───────────────────────────────────────────────────────────

router.get("/drip-sequences", authenticateAdmin, requirePage("drip-sequences", "campaigns"), getAllDripSequences);
router.post("/drip-sequences", authenticateAdmin, requirePage("drip-sequences", "campaigns"), requireAdmin, createDripSequence);
router.get("/drip-sequences/:id", authenticateAdmin, requirePage("drip-sequences", "campaigns"), getDripSequence);
router.put("/drip-sequences/:id", authenticateAdmin, requirePage("drip-sequences", "campaigns"), requireAdmin, updateDripSequence);
router.delete("/drip-sequences/:id", authenticateAdmin, requirePage("drip-sequences", "campaigns"), requireAdmin, deleteDripSequence);
router.post("/drip-sequences/:id/activate", authenticateAdmin, requirePage("drip-sequences", "campaigns"), requireAdmin, activateDripSequence);
router.post("/drip-sequences/:id/deactivate", authenticateAdmin, requirePage("drip-sequences", "campaigns"), requireMarketing, deactivateDripSequence);

// ─── Image Upload (Cloudinary) ────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const imageFileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed."), false);
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const XSS_OPTIONS = new xss.FilterXSS({
  whiteList: {
    p: ["class", "id"], h2: ["class", "id"], h3: ["class", "id"],
    ul: ["class", "id"], ol: ["class", "id"], li: ["class", "id"],
    strong: [], em: [], br: [], hr: [],
    a: ["href", "target", "rel"],
    blockquote: ["class", "id"],
    span: ["class", "id"], div: ["class", "id"],
    table: ["class", "id"], thead: [], tbody: [], tr: [], th: ["class", "id"], td: ["class", "id"],
    img: ["src", "alt", "width", "height", "loading", "class", "id"],
    figure: ["class", "id"], figcaption: [],
    code: ["class", "id"], pre: ["class", "id"],
  },
  onTagAttr: (tag, name, value) => {
    if (name === "href" && !/^https?:|^mailto:|^\//i.test(value)) return "";
    if (name === "src" && !/^https?:|^\//i.test(value)) return "";
  },
});

const sanitizeContent = (content) => content ? XSS_OPTIONS.process(content) : content;

// POST /admin/upload-image
router.post("/upload-image", authenticateAdmin, requirePage("blogs", "courses"), adminUploadLimiter, (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || "Upload error." });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded." });
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "technohana/admin-uploads", resource_type: "image" },
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
router.get("/instructors/resume-proxy", authenticateAdmin, requirePage("instructors"), async (req, res) => {
  const { url, disposition = "attachment" } = req.query;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!url || !url.startsWith(`https://res.cloudinary.com/${cloudName}/`)) {
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
router.get("/instructors", authenticateAdmin, requirePage("instructors"), async (req, res) => {
  try {
    const { status, page = 1, limit = 500 } = req.query;
    const filter = status ? { status } : {};
    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      Instructor.find(filter).sort({ submittedAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Instructor.countDocuments(filter),
    ]);
    return res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /admin/instructors/:id/status - Update instructor application status
router.patch("/instructors/:id/status", authenticateAdmin, requirePage("instructors"), requireAdmin, async (req, res) => {
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

// PATCH /admin/instructors/:id - Update notes, assignedTo, nextFollowUp
router.patch("/instructors/:id", authenticateAdmin, requirePage("instructors"), requireAdmin, async (req, res) => {
  try {
    const { notes, assignedTo, nextFollowUp } = req.body;
    const update = {};
    if (notes !== undefined) update.notes = notes;
    if (assignedTo !== undefined) update.assignedTo = assignedTo;
    if (nextFollowUp !== undefined) update.nextFollowUp = nextFollowUp || null;
    const updated = await Instructor.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ message: "Instructor not found." });
    return res.json({ data: updated });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /admin/instructors/:id - Delete instructor application + Cloudinary resume
router.delete("/instructors/:id", authenticateAdmin, requirePage("instructors"), requireAdmin, async (req, res) => {
  try {
    const instructor = await Instructor.findById(req.params.id);
    if (!instructor) return res.status(404).json({ message: "Instructor not found." });
    if (instructor.resumePublicId) {
      await cloudinary.uploader.destroy(instructor.resumePublicId, { resource_type: "raw" }).catch(() => {});
    }
    await instructor.deleteOne();
    return res.json({ message: "Deleted." });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /admin/instructors/:id/email - Send templated email to instructor
router.post("/instructors/:id/email", authenticateAdmin, requirePage("instructors"), requireAdmin, async (req, res) => {
  try {
    const instructor = await Instructor.findById(req.params.id).lean();
    if (!instructor) return res.status(404).json({ message: "Instructor not found." });

    const { template, customMessage } = req.body;
    const name = instructor.name || "Instructor";

    const templates = {
      shortlist: {
        subject: "Your Technohana Instructor Application — Next Steps",
        html: `<p>Hi ${name},</p><p>Great news! We've reviewed your application and would love to schedule a brief interview. Please reply to this email with your availability.</p>${customMessage ? `<p>${customMessage}</p>` : ""}<p>Best regards,<br/>Technohana Careers Team</p>`,
      },
      reject: {
        subject: "Your Technohana Instructor Application",
        html: `<p>Hi ${name},</p><p>Thank you for applying to join Technohana as an instructor. After careful review, we won't be moving forward at this time. We'll keep your profile on file for future opportunities.</p>${customMessage ? `<p>${customMessage}</p>` : ""}<p>Best regards,<br/>Technohana Careers Team</p>`,
      },
      onboard: {
        subject: "Welcome to Technohana — Onboarding Next Steps",
        html: `<p>Hi ${name},</p><p>We're thrilled to have you on board as a Technohana instructor! Our team will reach out shortly with your onboarding details and first assignment.</p>${customMessage ? `<p>${customMessage}</p>` : ""}<p>Best regards,<br/>Technohana Careers Team</p>`,
      },
      custom: {
        subject: "Message from Technohana",
        html: `<p>Hi ${name},</p><p>${customMessage || ""}</p><p>Best regards,<br/>Technohana Careers Team</p>`,
      },
    };

    const tpl = templates[template];
    if (!tpl) return res.status(400).json({ message: "Invalid template." });

    const statusMap = { shortlist: "shortlisted", reject: "rejected" };
    if (statusMap[template]) {
      await Instructor.findByIdAndUpdate(req.params.id, { status: statusMap[template] });
    }

    await sendEmail({ from: fromAddresses.careers, to: instructor.email, subject: tpl.subject, html: tpl.html });
    return res.json({ message: "Email sent." });
  } catch (err) {
    console.error("Instructor email error:", err);
    return res.status(500).json({ message: "Failed to send email." });
  }
});

// ─── Instructor Portal: Activate Account ─────────────────────────────────────
router.patch("/instructors/:id/activate", authenticateAdmin, requirePage("instructors"), requireAdmin, async (req, res) => {
  try {
    const instructor = await Instructor.findById(req.params.id);
    if (!instructor) return res.status(404).json({ success: false, message: "Instructor not found" });

    const { token, hash } = generateResetToken();
    await Instructor.findByIdAndUpdate(instructor._id, {
      resetToken: hash,
      resetTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const link = `${process.env.FRONTEND_URL}/instructor/set-password?token=${token}`;
    await sendEmail({
      from: fromAddresses.careers,
      to: instructor.email,
      subject: "Welcome to Technohana — Set up your instructor account",
      html: instructorSetPasswordEmail(instructor.name, link),
    });

    return res.json({ success: true, message: "Activation email sent" });
  } catch (err) {
    console.error("Activate instructor error:", err);
    return res.status(500).json({ success: false, message: "Failed to send activation email" });
  }
});

// ─── Admin: Assign Instructor to Course ──────────────────────────────────────
router.patch("/courses/:id/assign-instructor", authenticateAdmin, requirePage("courses"), requireAdmin, async (req, res) => {
  try {
    const { instructorId } = req.body;
    const instructor = instructorId ? await Instructor.findById(instructorId).select("name isActive").lean() : null;
    if (instructorId && (!instructor || !instructor.isActive))
      return res.status(400).json({ success: false, message: "Instructor not found or not active" });

    const course = await Course.findByIdAndUpdate(
      req.params.id,
      instructorId
        ? { instructorId, instructor: instructor.name }
        : { $unset: { instructorId: "" } },
      { new: true }
    ).lean();

    if (!course) return res.status(404).json({ success: false, message: "Course not found" });
    return res.json({ success: true, data: course });
  } catch (err) {
    console.error("Assign instructor error:", err);
    return res.status(500).json({ success: false, message: "Failed to assign instructor" });
  }
});

// ─── Admin: Training Requirements ────────────────────────────────────────────
router.post("/training-requirements", authenticateAdmin, requirePage("instructors"), async (req, res) => {
  try {
    const { title, description, topic, expertise, deliveryMode, duration, participants, budgetRange, startDate, deadline, location } = req.body;
    if (!title || !description)
      return res.status(400).json({ success: false, message: "Title and description are required" });

    const requirement = await TrainingRequirement.create({
      title,
      description,
      postedBy: req.admin?.name || "Admin",
      ...(topic        && { topic }),
      ...(expertise    && { expertise }),
      ...(deliveryMode && { deliveryMode }),
      ...(duration     && { duration }),
      ...(budgetRange  && { budgetRange }),
      ...(location     && { location }),
      ...(participants && { participants }),
      ...(startDate    && { startDate }),
      ...(deadline     && { deadline }),
    });

    // Notify all active instructors — fire and forget so the response returns immediately
    const activeInstructors = await Instructor.find({ isActive: true }).select("name email").lean();
    const portalLink = `${process.env.FRONTEND_URL}/instructor/opportunities`;
    const notifiedCount = activeInstructors.length;

    Promise.allSettled(
      activeInstructors.map((inst) =>
        sendEmail({
          from: fromAddresses.careers,
          to: inst.email,
          subject: `New Training Opportunity: ${title}`,
          html: newRequirementNotificationEmail(inst.name, requirement, portalLink),
        })
      )
    ).then((results) => {
      const sent = results.filter((r) => r.status === "fulfilled").length;
      TrainingRequirement.findByIdAndUpdate(requirement._id, { notifiedCount: sent }).catch(() => {});
    }).catch(() => {});

    return res.status(201).json({ success: true, data: { ...requirement.toObject(), notifiedCount } });
  } catch (err) {
    console.error("Create requirement error:", err);
    return res.status(500).json({ success: false, message: "Failed to create requirement" });
  }
});

router.get("/training-requirements", authenticateAdmin, requirePage("instructors"), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const requirements = await TrainingRequirement.find(filter).sort({ createdAt: -1 }).lean();

    // Attach application counts
    const ids = requirements.map((r) => r._id);
    const counts = await InstructorApplication.aggregate([
      { $match: { requirementId: { $in: ids } } },
      { $group: { _id: "$requirementId", total: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.total]));

    const data = requirements.map((r) => ({ ...r, applicationCount: countMap[String(r._id)] || 0 }));
    return res.json({ success: true, data });
  } catch (err) {
    console.error("Get requirements error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch requirements" });
  }
});

router.patch("/training-requirements/:id", authenticateAdmin, requirePage("instructors"), async (req, res) => {
  try {
    const allowed = ["title", "description", "topic", "expertise", "deliveryMode", "duration", "participants", "budgetRange", "startDate", "deadline", "location", "status"];
    const dateFields = new Set(["startDate", "deadline"]);
    const numberFields = new Set(["participants"]);
    const updates = Object.fromEntries(
      Object.entries(req.body)
        .filter(([k]) => allowed.includes(k))
        .filter(([k, v]) => !(dateFields.has(k) || numberFields.has(k)) || (v !== "" && v != null))
    );
    const requirement = await TrainingRequirement.findByIdAndUpdate(req.params.id, updates, { new: true }).lean();
    if (!requirement) return res.status(404).json({ success: false, message: "Requirement not found" });
    return res.json({ success: true, data: requirement });
  } catch (err) {
    console.error("Update requirement error:", err);
    return res.status(500).json({ success: false, message: "Failed to update requirement" });
  }
});

router.delete("/training-requirements/:id", authenticateAdmin, requirePage("instructors"), requireAdmin, async (req, res) => {
  try {
    await TrainingRequirement.findByIdAndDelete(req.params.id);
    await InstructorApplication.deleteMany({ requirementId: req.params.id });
    return res.json({ success: true, message: "Requirement deleted" });
  } catch (err) {
    console.error("Delete requirement error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete requirement" });
  }
});

router.get("/training-requirements/:id/applications", authenticateAdmin, requirePage("instructors"), async (req, res) => {
  try {
    const applications = await InstructorApplication.find({ requirementId: req.params.id })
      .populate("instructorId", "name email phone expertise experience dailyRate availability deliveryMode linkedinUrl")
      .sort({ submittedAt: -1 })
      .lean();
    return res.json({ success: true, data: applications });
  } catch (err) {
    console.error("Get applications error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch applications" });
  }
});

router.patch("/training-requirements/:id/applications/:appId", authenticateAdmin, requirePage("instructors"), async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const validStatuses = ["applied", "shortlisted", "accepted", "rejected"];
    if (status && !validStatuses.includes(status))
      return res.status(400).json({ success: false, message: "Invalid status" });

    const app = await InstructorApplication.findOneAndUpdate(
      { _id: req.params.appId, requirementId: req.params.id },
      { ...(status && { status, respondedAt: new Date() }), ...(adminNotes !== undefined && { adminNotes }) },
      { new: true }
    ).populate("instructorId", "name email").populate("requirementId", "title");

    if (!app) return res.status(404).json({ success: false, message: "Application not found" });

    // Email instructor on accept/reject
    if (status === "accepted" || status === "rejected") {
      try {
        await sendEmail({
          from: fromAddresses.careers,
          to: app.instructorId.email,
          subject: `Your application for "${app.requirementId.title}" — ${status === "accepted" ? "Great news!" : "Update"}`,
          html: applicationStatusEmail(app.instructorId.name, app.requirementId.title, status, adminNotes),
        });
      } catch { /* non-blocking */ }
    }

    return res.json({ success: true, data: app });
  } catch (err) {
    console.error("Update application error:", err);
    return res.status(500).json({ success: false, message: "Failed to update application" });
  }
});

// ─── Proposals ───────────────────────────────────────────────────────────────
router.post("/proposals/quote",  authenticateAdmin, requirePage("proposals", "proposal-builder"), quoteProposalLine);
router.get("/proposals",         authenticateAdmin, requirePage("proposals", "proposal-builder"), getProposals);
router.post("/proposals",        authenticateAdmin, requirePage("proposals", "proposal-builder"), createProposal);
router.get("/proposals/:id",     authenticateAdmin, requirePage("proposals", "proposal-builder"), getProposal);
router.put("/proposals/:id",     authenticateAdmin, requirePage("proposals", "proposal-builder"), updateProposal);
router.delete("/proposals/:id",  authenticateAdmin, requirePage("proposals", "proposal-builder"), requireAdmin, deleteProposal);

// ─── CRM Contacts ─────────────────────────────────────────────────────────────
router.get("/contacts",       authenticateAdmin, requirePage("crm"), adminDataLimiter, getContacts);
router.get("/contacts/:email", authenticateAdmin, requirePage("crm"), adminDataLimiter, getContactProfile);

export default router;
