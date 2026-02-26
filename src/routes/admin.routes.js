import express from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { User } from "../models/user.model.js";
import Enquiry from "../models/enquiry.model.js";
import AiRiskReport from "../models/aiRiskReport.model.js";
import Subscription from "../models/subscription.model.js";
import { Blogs } from "../models/blogs.model.js";
import Course from "../models/course.model.js";
import { CourseView } from "../models/courseView.model.js";
import { authenticateAdmin } from "../middleware/authenticateAdmin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ─── POST /admin/login ────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  if (
    email !== process.env.ADMIN_EMAIL ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({ message: "Invalid credentials." });
  }

  const token = jwt.sign(
    { email, role: "admin" },
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
    ]);

    return res.json({
      enrollments: { total: totalEnrollments, pendingPayment, inProgress, enrolled, rejected },
      enquiries,
      aiRiskReports,
      subscribers,
      blogs,
      courses,
      courseViews,
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
router.patch("/enrollments/:id/status", authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["pending-payment", "in-progress", "enrolled", "rejected"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Enrollment not found." });

    return res.json({ data: updated });
  } catch (err) {
    console.error("Admin update status error:", err);
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
router.post("/blogs", authenticateAdmin, async (req, res) => {
  try {
    const { title, slug, img, author, date, content, category } = req.body;
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
    const { title, slug, img, author, date, content, category } = req.body;
    const updated = await Blogs.findByIdAndUpdate(
      req.params.id,
      { title, slug, img, author, date, content, category },
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
router.delete("/blogs/:id", authenticateAdmin, async (req, res) => {
  try {
    const deleted = await Blogs.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Blog not found." });
    return res.json({ message: "Blog deleted." });
  } catch (err) {
    console.error("Admin delete blog error:", err);
    return res.status(500).json({ message: "Server error" });
  }
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
router.post("/courses", authenticateAdmin, async (req, res) => {
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
router.delete("/courses/:id", authenticateAdmin, async (req, res) => {
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
router.delete("/courses/clear", authenticateAdmin, async (req, res) => {
  try {
    const result = await Course.deleteMany({});
    return res.json({ message: "Cleared all courses", deleted: result.deletedCount });
  } catch (err) {
    console.error("Admin clear courses error:", err);
    return res.status(500).json({ message: "Server error", detail: err.message });
  }
});

// POST /admin/courses/seed — import from src/data/courses.json (can reseed if force=true)
router.post("/courses/seed", authenticateAdmin, async (req, res) => {
  try {
    const { force } = req.body;
    const existing = await Course.countDocuments();

    if (existing > 0 && !force) {
      return res.json({ message: "Already seeded", count: existing });
    }

    if (force && existing > 0) {
      await Course.deleteMany({});
      console.log(`Cleared ${existing} courses for reseed`);
    }

    const dataPath = path.join(__dirname, "../data/courses.json");
    const raw = fs.readFileSync(dataPath, "utf-8");
    const courses = JSON.parse(raw);

    const result = await Course.insertMany(courses, { ordered: false });
    const inserted = result.length;
    return res.status(201).json({
      message: `Seeded ${inserted} courses successfully`,
      count: inserted,
      total: courses.length,
      failed: courses.length - inserted
    });
  } catch (err) {
    console.error("Admin seed courses error:", err);

    // If partialResult exists, some courses were inserted
    if (err.writeErrors && err.writeErrors.length > 0) {
      const successful = Course.countDocuments();
      console.error(`Failed to insert ${err.writeErrors.length} courses:`,
        err.writeErrors.map(e => ({ id: e.err.op?.id, error: e.err.errmsg }))
      );
      return res.status(207).json({
        message: "Partial seed - some courses failed",
        detail: err.writeErrors.map(e => e.err.errmsg),
        errors: err.writeErrors.length
      });
    }

    return res.status(500).json({ message: "Server error", detail: err.message });
  }
});

export default router;
