import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import Instructor from "../models/instructor.js";
import Course from "../models/course.model.js";
import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import TrainingRequirement from "../models/trainingRequirement.model.js";
import InstructorApplication from "../models/instructorApplication.model.js";
import { authenticateInstructor } from "../middleware/authenticateInstructor.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { instructorPasswordResetEmail } from "../utils/emailTemplate.js";

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();

const generateInstructorToken = (instructor) =>
  jwt.sign(
    { id: instructor._id, name: instructor.name, email: instructor.email, role: "instructor" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password required" });

    const instructor = await Instructor.findOne({ email: email.toLowerCase().trim() });
    if (!instructor || !instructor.isActive || !instructor.passwordHash)
      return res.status(401).json({ success: false, message: "Invalid credentials or account not activated" });

    const match = await bcrypt.compare(password, instructor.passwordHash);
    if (!match)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    await Instructor.findByIdAndUpdate(instructor._id, { lastLogin: new Date() });

    return res.json({ success: true, token: generateInstructorToken(instructor) });
  } catch {
    return res.status(500).json({ success: false, message: "Login failed" });
  }
});

router.post("/auth/set-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ success: false, message: "Token and password required" });
    if (password.length < 8)
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });

    const instructor = await Instructor.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: new Date() },
    });
    if (!instructor)
      return res.status(400).json({ success: false, message: "Invalid or expired link" });

    const passwordHash = await bcrypt.hash(password, 12);
    await Instructor.findByIdAndUpdate(instructor._id, {
      passwordHash,
      resetToken: null,
      resetTokenExpiry: null,
      isActive: true,
    });

    return res.json({ success: true, message: "Password set successfully", token: generateInstructorToken(instructor) });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to set password" });
  }
});

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: "Email required" });

    const instructor = await Instructor.findOne({ email: email.toLowerCase().trim(), isActive: true });
    if (!instructor)
      return res.json({ success: true, message: "If an account exists, a reset link has been sent" });

    const resetToken = crypto.randomBytes(32).toString("hex");
    await Instructor.findByIdAndUpdate(instructor._id, {
      resetToken,
      resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    });

    const resetLink = `${process.env.FRONTEND_URL}/instructor/set-password?token=${resetToken}`;
    await sendEmail({
      from: fromAddresses.careers,
      to: instructor.email,
      subject: "Reset your Technohana instructor password",
      html: instructorPasswordResetEmail(instructor.name, resetLink),
    });

    return res.json({ success: true, message: "If an account exists, a reset link has been sent" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to process request" });
  }
});

// ── Profile ───────────────────────────────────────────────────────────────────

router.get("/me", authenticateInstructor, async (req, res) => {
  try {
    const instructor = await Instructor.findById(req.instructor.id)
      .select("-passwordHash -resetToken -resetTokenExpiry")
      .lean();
    if (!instructor)
      return res.status(404).json({ success: false, message: "Instructor not found" });

    return res.json({ success: true, data: instructor });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch profile" });
  }
});

router.put("/me", authenticateInstructor, async (req, res) => {
  try {
    const allowed = ["name", "phone", "expertise", "experience", "linkedinUrl", "dailyRate", "availability", "deliveryMode", "certifications", "picture"];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    const instructor = await Instructor.findByIdAndUpdate(req.instructor.id, updates, { new: true })
      .select("-passwordHash -resetToken -resetTokenExpiry")
      .lean();

    return res.json({ success: true, data: instructor });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update profile" });
  }
});

// ── File Uploads ──────────────────────────────────────────────────────────────

router.post("/me/photo", authenticateInstructor, memUpload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
  if (!req.file.mimetype.startsWith("image/"))
    return res.status(400).json({ success: false, message: "Image files only" });
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "technohana/instructor-photos", resource_type: "image" },
        (err, r) => (err ? reject(err) : resolve(r))
      );
      stream.end(req.file.buffer);
    });
    await Instructor.findByIdAndUpdate(req.instructor.id, { picture: result.secure_url });
    return res.json({ success: true, url: result.secure_url });
  } catch {
    return res.status(500).json({ success: false, message: "Upload failed" });
  }
});

router.post("/me/resume", authenticateInstructor, memUpload.single("resume"), async (req, res) => {
  const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
  if (!req.file || !allowed.includes(req.file.mimetype))
    return res.status(400).json({ success: false, message: "PDF or Word file required" });
  try {
    const existing = await Instructor.findById(req.instructor.id).select("resumePublicId").lean();
    if (existing?.resumePublicId) {
      cloudinary.uploader.destroy(existing.resumePublicId, { resource_type: "raw" }).catch(() => {});
    }
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "technohana/instructor-resumes", resource_type: "raw" },
        (err, r) => (err ? reject(err) : resolve(r))
      );
      stream.end(req.file.buffer);
    });
    await Instructor.findByIdAndUpdate(req.instructor.id, {
      resumeUrl: result.secure_url,
      resumePublicId: result.public_id,
    });
    return res.json({ success: true, url: result.secure_url });
  } catch {
    return res.status(500).json({ success: false, message: "Upload failed" });
  }
});

router.get("/me/resume-proxy", authenticateInstructor, async (req, res) => {
  const { url } = req.query;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!url || !url.startsWith(`https://res.cloudinary.com/${cloudName}/`))
    return res.status(400).json({ success: false, message: "Invalid URL" });
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(\?|$)/);
    if (!match) return res.status(400).json({ success: false, message: "Could not parse public_id" });
    const signedUrl = cloudinary.utils.private_download_url(match[1], null, {
      resource_type: "raw",
      type: "upload",
      attachment: false,
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
    return res.redirect(302, signedUrl);
  } catch {
    return res.status(502).json({ success: false, message: "Failed to generate signed URL" });
  }
});

// ── Courses ───────────────────────────────────────────────────────────────────

router.get("/courses", authenticateInstructor, async (req, res) => {
  try {
    const courses = await Course.find({ instructorId: req.instructor.id }).lean();
    return res.json({ success: true, data: courses });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch courses" });
  }
});

router.get("/courses/:courseId/students", authenticateInstructor, async (req, res) => {
  try {
    const { courseId } = req.params;

    // Verify this course belongs to the instructor
    const course = await Course.findOne({ _id: courseId, instructorId: req.instructor.id }).lean();
    if (!course)
      return res.status(403).json({ success: false, message: "Course not found or not assigned to you" });

    const students = await User.find({ courseTitle: course.courseTitle, status: { $ne: "rejected" } })
      .select("name email phone status progress completedLessons createdAt")
      .lean();

    return res.json({ success: true, data: students, courseTitle: course.courseTitle });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch students" });
  }
});

// ── Earnings ──────────────────────────────────────────────────────────────────

router.get("/earnings", authenticateInstructor, async (req, res) => {
  try {
    const courses = await Course.find({ instructorId: req.instructor.id }).lean();
    if (!courses.length)
      return res.json({ success: true, data: { total: 0, byMonth: [], byCourse: [] } });

    const courseIds = courses.map((c) => c.id || String(c._id));

    const orders = await Order.find({ courseId: { $in: courseIds }, status: "paid" }).lean();

    // Group by course
    const byCourse = courses.map((course) => {
      const cid = course.id || String(course._id);
      const courseOrders = orders.filter((o) => o.courseId === cid);
      const gross = courseOrders.reduce((sum, o) => sum + (o.basePriceMinor || 0) * (o.participants || 1), 0);
      const revenue = courseOrders.reduce((sum, o) => {
        const base = (o.basePriceMinor || 0) * (o.participants || 1);
        const discount = (o.totalDiscountPercent || 0) / 100;
        return sum + base * (1 - discount);
      }, 0);
      return {
        courseId: cid,
        courseTitle: course.courseTitle,
        enrollments: courseOrders.length,
        grossMinor: gross,
        revenueMinor: revenue,
        revenueMajor: (revenue / 100).toFixed(2),
      };
    });

    // Group by month
    const monthMap = {};
    orders.forEach((o) => {
      const d = new Date(o.paidAt || o.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!monthMap[key]) monthMap[key] = 0;
      const base = (o.basePriceMinor || 0) * (o.participants || 1);
      const discount = (o.totalDiscountPercent || 0) / 100;
      monthMap[key] += base * (1 - discount);
    });
    const byMonth = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, revenueMinor]) => ({ month, revenueMinor, revenueMajor: (revenueMinor / 100).toFixed(2) }));

    const totalMinor = byCourse.reduce((s, c) => s + c.revenueMinor, 0);

    return res.json({
      success: true,
      data: { totalMinor, totalMajor: (totalMinor / 100).toFixed(2), byMonth, byCourse },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch earnings" });
  }
});

// ── Training Requirements (Gig Board) ─────────────────────────────────────────

router.get("/requirements", authenticateInstructor, async (req, res) => {
  try {
    const requirements = await TrainingRequirement.find({ status: "open" })
      .sort({ createdAt: -1 })
      .lean();

    // Annotate with this instructor's application status
    const appMap = {};
    const apps = await InstructorApplication.find({ instructorId: req.instructor.id }).lean();
    apps.forEach((a) => { appMap[String(a.requirementId)] = a.status; });

    const data = requirements.map((r) => ({
      ...r,
      myApplicationStatus: appMap[String(r._id)] || null,
    }));

    return res.json({ success: true, data });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch requirements" });
  }
});

router.post("/requirements/:id/apply", authenticateInstructor, async (req, res) => {
  try {
    const requirement = await TrainingRequirement.findOne({ _id: req.params.id, status: "open" });
    if (!requirement)
      return res.status(404).json({ success: false, message: "Requirement not found or closed" });

    const existing = await InstructorApplication.findOne({
      requirementId: requirement._id,
      instructorId: req.instructor.id,
    });
    if (existing)
      return res.status(409).json({ success: false, message: "You have already applied to this requirement" });

    const { proposedRate, coverLetter, availability } = req.body;
    const application = await InstructorApplication.create({
      requirementId: requirement._id,
      instructorId: req.instructor.id,
      proposedRate,
      coverLetter,
      availability,
    });

    return res.status(201).json({ success: true, data: application });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to submit application" });
  }
});

router.get("/applications", authenticateInstructor, async (req, res) => {
  try {
    const applications = await InstructorApplication.find({ instructorId: req.instructor.id })
      .populate("requirementId", "title topic budgetRange deadline status")
      .sort({ submittedAt: -1 })
      .lean();

    return res.json({ success: true, data: applications });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch applications" });
  }
});

export default router;
