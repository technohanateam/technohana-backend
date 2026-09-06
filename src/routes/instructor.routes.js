import express from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import Instructor from "../models/instructor.js";
import Course from "../models/course.model.js";
import { User } from "../models/user.model.js";
import TrainingRequirement from "../models/trainingRequirement.model.js";
import InstructorApplication from "../models/instructorApplication.model.js";
import InstructorReview from "../models/instructorReview.model.js";
import InstructorPayout from "../models/instructorPayout.model.js";
import InstructorAgreement from "../models/instructorAgreement.model.js";
import InstructorAgreementAcceptance from "../models/instructorAgreementAcceptance.model.js";
import InstructorComplianceQuiz from "../models/instructorComplianceQuiz.model.js";
import InstructorComplianceSettings from "../models/instructorComplianceSettings.model.js";
import { authenticateInstructor } from "../middleware/authenticateInstructor.js";
import { requireCompliance } from "../middleware/requireCompliance.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { instructorPasswordResetEmail, payoutRequestedEmail } from "../utils/emailTemplate.js";
import { generateResetToken, hashToken } from "../utils/resetTokenUtil.js";
import { computeInstructorEarnings } from "../utils/instructorEarnings.js";
import { encryptToken } from "../utils/tokenCrypto.js";

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();

const instructorPasswordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP address
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many password reset attempts. Please try again after 15 minutes.',
});

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

router.post("/auth/set-password", instructorPasswordResetLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ success: false, message: "Token and password required" });
    if (password.length < 8)
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });

    const hash = hashToken(token);
    const instructor = await Instructor.findOne({
      resetToken: hash,
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

router.post("/auth/forgot-password", instructorPasswordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: "Email required" });

    const instructor = await Instructor.findOne({ email: email.toLowerCase().trim(), isActive: true });
    if (!instructor)
      return res.json({ success: true, message: "If an account exists, a reset link has been sent" });

    const { token, hash } = generateResetToken();
    await Instructor.findByIdAndUpdate(instructor._id, {
      resetToken: hash,
      resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    });

    const resetLink = `${process.env.FRONTEND_URL}/instructor/set-password?token=${token}`;
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
      .select("-passwordHash -resetToken -resetTokenExpiry -payoutDetailsEncrypted")
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
      .select("-passwordHash -resetToken -resetTokenExpiry -payoutDetailsEncrypted")
      .lean();

    return res.json({ success: true, data: instructor });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update profile" });
  }
});

// ── Compliance (NDA + Ethics Quiz) ──────────────────────────────────────────────

router.get("/compliance/agreement", authenticateInstructor, async (req, res) => {
  try {
    const agreement = await InstructorAgreement.findOne({ isActive: true }).lean();
    if (!agreement)
      return res.status(404).json({ success: false, message: "No active agreement found" });
    return res.json({ success: true, data: agreement });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch agreement" });
  }
});

router.post("/compliance/agreement/accept", authenticateInstructor, async (req, res) => {
  try {
    const { typedFullName } = req.body;
    if (!typedFullName || !typedFullName.trim())
      return res.status(400).json({ success: false, message: "Full name is required to accept the agreement" });

    const agreement = await InstructorAgreement.findOne({ isActive: true }).lean();
    if (!agreement)
      return res.status(404).json({ success: false, message: "No active agreement found" });

    await InstructorAgreementAcceptance.findOneAndUpdate(
      { instructorId: req.instructor.id, agreementVersion: agreement.version },
      {
        instructorId: req.instructor.id,
        agreementVersion: agreement.version,
        typedFullName: typedFullName.trim(),
        ipAddress: req.ip,
        acceptedAt: new Date(),
      },
      { upsert: true }
    );

    await Instructor.findByIdAndUpdate(req.instructor.id, {
      "complianceStatus.ndaAccepted": true,
      "complianceStatus.ndaAcceptedVersion": agreement.version,
    });

    return res.json({ success: true, message: "Agreement accepted" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to accept agreement" });
  }
});

router.get("/compliance/quiz", authenticateInstructor, async (req, res) => {
  try {
    const settings = await InstructorComplianceSettings.findOne({}).lean();
    if (!settings || !settings.questions?.length)
      return res.status(404).json({ success: false, message: "No compliance quiz configured" });

    // Never leak correctIndex to the client
    const questions = settings.questions.map(({ id, question, options }) => ({ id, question, options }));
    return res.json({ success: true, data: { questions } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch quiz" });
  }
});

router.post("/compliance/quiz/submit", authenticateInstructor, async (req, res) => {
  try {
    const { answers } = req.body; // [{ questionId, selected }]
    if (!Array.isArray(answers) || !answers.length)
      return res.status(400).json({ success: false, message: "Answers are required" });

    const settings = await InstructorComplianceSettings.findOne({}).lean();
    if (!settings || !settings.questions?.length)
      return res.status(404).json({ success: false, message: "No compliance quiz configured" });

    const correctById = new Map(settings.questions.map((q) => [q.id, q.correctIndex]));
    const scoredAnswers = answers.map((a) => ({
      questionId: a.questionId,
      selected: a.selected,
      isCorrect: correctById.get(a.questionId) === a.selected,
    }));
    const score = scoredAnswers.filter((a) => a.isCorrect).length;
    const totalQuestions = settings.questions.length;
    const percentage = Math.round((score / totalQuestions) * 100);
    const passed = percentage >= (settings.passThresholdPercent ?? 80);

    const attemptCount = await InstructorComplianceQuiz.countDocuments({ instructorId: req.instructor.id });
    await InstructorComplianceQuiz.create({
      instructorId: req.instructor.id,
      answers: scoredAnswers,
      score,
      totalQuestions,
      percentage,
      passed,
      attemptNumber: attemptCount + 1,
    });

    if (passed) {
      await Instructor.findByIdAndUpdate(req.instructor.id, {
        "complianceStatus.quizPassed": true,
        "complianceStatus.quizPassedAt": new Date(),
      });
    }

    return res.json({ success: true, data: { score, totalQuestions, percentage, passed } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to submit quiz" });
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

router.get("/courses", authenticateInstructor, requireCompliance, async (req, res) => {
  try {
    const courses = await Course.find({ instructorId: req.instructor.id }).lean();
    return res.json({ success: true, data: courses });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch courses" });
  }
});

router.get("/courses/:courseId/students", authenticateInstructor, requireCompliance, async (req, res) => {
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

router.get("/earnings", authenticateInstructor, requireCompliance, async (req, res) => {
  try {
    const { totalMinor, byMonth, byCourse } = await computeInstructorEarnings(req.instructor.id);
    return res.json({
      success: true,
      data: { totalMinor, totalMajor: (totalMinor / 100).toFixed(2), byMonth, byCourse },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch earnings" });
  }
});

// ── Payouts ───────────────────────────────────────────────────────────────────

const PAYOUT_PENDING_STATUSES = ["requested", "approved", "processing", "paid"];

router.get("/payout-details", authenticateInstructor, requireCompliance, async (req, res) => {
  try {
    const instructor = await Instructor.findById(req.instructor.id)
      .select("payoutMethod payoutLastFour payoutCountry payoutCurrency payoutDetailsEncrypted")
      .lean();
    if (!instructor)
      return res.status(404).json({ success: false, message: "Instructor not found" });

    return res.json({
      success: true,
      data: {
        payoutMethod: instructor.payoutMethod || null,
        payoutLastFour: instructor.payoutLastFour || "",
        payoutCountry: instructor.payoutCountry || "",
        payoutCurrency: instructor.payoutCurrency || "INR",
        hasDetails: Boolean(instructor.payoutDetailsEncrypted),
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch payout details" });
  }
});

router.put("/payout-details", authenticateInstructor, requireCompliance, async (req, res) => {
  try {
    const { method, accountHolderName, bankName, accountNumber, ifscCode, swiftCode, upiId, country, currency } = req.body;
    if (!["bank", "upi"].includes(method))
      return res.status(400).json({ success: false, message: "Method must be 'bank' or 'upi'" });

    const identifier = method === "upi" ? upiId : accountNumber;
    if (!identifier || !identifier.trim())
      return res.status(400).json({ success: false, message: method === "upi" ? "UPI ID is required" : "Account number is required" });

    const payoutDetailsEncrypted = encryptToken({ accountHolderName, bankName, accountNumber, ifscCode, swiftCode, upiId });
    const payoutLastFour = identifier.trim().slice(-4);

    await Instructor.findByIdAndUpdate(req.instructor.id, {
      payoutMethod: method,
      payoutLastFour,
      payoutDetailsEncrypted,
      payoutCountry: country || "",
      payoutCurrency: currency || "INR",
    });

    return res.json({ success: true, data: { payoutMethod: method, payoutLastFour, hasDetails: true } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to save payout details" });
  }
});

router.get("/payouts", authenticateInstructor, requireCompliance, async (req, res) => {
  try {
    const [payouts, { totalMinor }] = await Promise.all([
      InstructorPayout.find({ instructorId: req.instructor.id })
        .select("-payoutDetailsSnapshotEncrypted")
        .sort({ requestedAt: -1 })
        .lean(),
      computeInstructorEarnings(req.instructor.id),
    ]);

    const committedMinor = payouts
      .filter((p) => PAYOUT_PENDING_STATUSES.includes(p.status))
      .reduce((sum, p) => sum + p.amountMinor, 0);
    const availableMinor = Math.max(totalMinor - committedMinor, 0);

    return res.json({ success: true, data: { payouts, availableMinor, totalMinor } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch payouts" });
  }
});

router.post("/payouts", authenticateInstructor, requireCompliance, async (req, res) => {
  try {
    const { amountMinor } = req.body;
    if (!Number.isInteger(amountMinor) || amountMinor <= 0)
      return res.status(400).json({ success: false, message: "amountMinor must be a positive integer" });

    const instructor = await Instructor.findById(req.instructor.id)
      .select("name email payoutMethod payoutLastFour payoutDetailsEncrypted payoutCurrency")
      .lean();
    if (!instructor?.payoutDetailsEncrypted)
      return res.status(400).json({ success: false, message: "Add your payout details before requesting a payout" });

    const [{ totalMinor }, existingPayouts] = await Promise.all([
      computeInstructorEarnings(req.instructor.id),
      InstructorPayout.find({ instructorId: req.instructor.id, status: { $in: PAYOUT_PENDING_STATUSES } }).select("amountMinor").lean(),
    ]);
    const committedMinor = existingPayouts.reduce((sum, p) => sum + p.amountMinor, 0);
    const availableMinor = totalMinor - committedMinor;

    if (amountMinor > availableMinor)
      return res.status(400).json({ success: false, message: "Requested amount exceeds available balance" });

    const payout = await InstructorPayout.create({
      instructorId: req.instructor.id,
      amountMinor,
      currency: instructor.payoutCurrency || "INR",
      payoutMethod: instructor.payoutMethod,
      payoutLastFour: instructor.payoutLastFour,
      payoutDetailsSnapshotEncrypted: instructor.payoutDetailsEncrypted,
    });

    sendEmail({
      from: fromAddresses.careers,
      to: process.env.MAIL_TO,
      subject: `Payout requested by ${instructor.name}`,
      html: payoutRequestedEmail(instructor.name, (amountMinor / 100).toFixed(2), instructor.payoutCurrency || "INR"),
    }).catch(() => {});

    return res.status(201).json({ success: true, data: payout });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to submit payout request" });
  }
});

// ── Training Requirements (Gig Board) ─────────────────────────────────────────

router.get("/requirements", authenticateInstructor, requireCompliance, async (req, res) => {
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

router.post("/requirements/:id/apply", authenticateInstructor, requireCompliance, async (req, res) => {
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

router.get("/applications", authenticateInstructor, requireCompliance, async (req, res) => {
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

// ── Reviews ────────────────────────────────────────────────────────────────────

router.get("/reviews", authenticateInstructor, requireCompliance, async (req, res) => {
  try {
    const reviews = await InstructorReview.find({ instructorId: req.instructor.id })
      .populate("courseId", "courseTitle")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: reviews });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch reviews" });
  }
});

export default router;
