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
import Batch from "../models/batch.model.js";
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
import { resolveCourseSkills } from "../controllers/instructorForm.controller.js";
import {
  computeInstructorEarnings,
  computePayoutClaim,
  OPEN_PAYOUT_STATUSES,
  openPayoutKey,
} from "../utils/instructorEarnings.js";
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

// Slows password guessing on the public trainer login. Successful logins don't count.
const instructorLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many failed login attempts. Please try again in 15 minutes, or use "Forgot password".' },
});

const generateInstructorToken = (instructor) =>
  jwt.sign(
    { id: instructor._id, name: instructor.name, email: instructor.email, role: "instructor" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post("/auth/login", instructorLoginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password required" });

    const instructor = await Instructor.findOne({ email: email.toLowerCase().trim() });
    if (!instructor || !instructor.isActive || !instructor.passwordHash)
      return res.status(401).json({ success: false, message: "Invalid email or password" });

    const match = await bcrypt.compare(password, instructor.passwordHash);
    if (!match)
      return res.status(401).json({ success: false, message: "Invalid email or password" });

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

    const resetLink = `${process.env.TRAINERS_FRONTEND_URL || process.env.FRONTEND_URL}/instructor/set-password?token=${token}`;
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
    const allowed = ["name", "phone", "expertise", "experience", "linkedinUrl", "dailyRate", "availability", "deliveryMode", "certifications", "coverLetter", "picture"];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    if ("courseSkills" in req.body) {
      updates.courseSkills = await resolveCourseSkills(req.body.courseSkills);
    }

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

// Signs a download URL for the CALLER'S OWN resume only. The public_id is read
// from the instructor's own record — never from a query param. Accepting a
// caller-supplied URL here (as this route previously did, validating only the
// Cloudinary cloud-name prefix) let any authenticated instructor sign a download
// for any raw asset in the account, including another instructor's resume.
router.get("/me/resume-proxy", authenticateInstructor, async (req, res) => {
  try {
    const instructor = await Instructor.findById(req.instructor.id).select("resumePublicId").lean();
    if (!instructor?.resumePublicId)
      return res.status(404).json({ success: false, message: "No resume on file" });

    const signedUrl = cloudinary.utils.private_download_url(instructor.resumePublicId, null, {
      resource_type: "raw",
      type: "upload",
      attachment: false,
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
    // Returns the URL as JSON rather than a 302: the only caller opens it in a new
    // window, and following a redirect through axios would stream the file instead.
    return res.json({ success: true, url: signedUrl });
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

    // Legacy course-level roster, limited to learners in batches this instructor
    // runs. Joining on courseTitle alone exposed every cohort of the course,
    // including ones taught by other instructors.
    const batchIds = await Batch.find({ instructorId: req.instructor.id, courseId: course._id }).distinct("_id");
    const students = await User.find({ batchId: { $in: batchIds }, status: { $ne: "rejected" } })
      .select("name email status progress lessonsCompleted totalLessons batchId createdAt")
      .lean();

    return res.json({ success: true, data: students, courseTitle: course.courseTitle });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch students" });
  }
});

// ── Earnings ──────────────────────────────────────────────────────────────────

// Earnings come from delivered sessions at each batch's hourly rate, totalled in
// the trainer's payout currency; see utils/instructorEarnings.js.
const payoutCurrencyOf = async (instructorId) =>
  (await Instructor.findById(instructorId).select("payoutCurrency").lean())?.payoutCurrency || "INR";

router.get("/earnings", authenticateInstructor, requireCompliance, async (req, res) => {
  try {
    const earnings = await computeInstructorEarnings(req.instructor.id, await payoutCurrencyOf(req.instructor.id));
    return res.json({ success: true, data: earnings });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch earnings" });
  }
});

// ── Payouts ───────────────────────────────────────────────────────────────────

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
    const currency = await payoutCurrencyOf(req.instructor.id);
    const [payouts, claim] = await Promise.all([
      InstructorPayout.find({ instructorId: req.instructor.id })
        .select("-payoutDetailsSnapshotEncrypted -openKey")
        .sort({ requestedAt: -1 })
        .lean(),
      computePayoutClaim(req.instructor.id, currency),
    ]);
    const hasOpenRequest = payouts.some((p) => OPEN_PAYOUT_STATUSES.includes(p.status));

    return res.json({
      success: true,
      data: {
        payouts,
        currency,
        availableMinor: Math.max(claim.amountMinor, 0),
        hasOpenRequest,
        claim: {
          sessions: claim.lines.length,
          periodStart: claim.periodStart,
          periodEnd: claim.periodEnd,
          grossMinor: claim.grossMinor,
          tdsPercent: claim.tdsPercent,
          tdsMinor: claim.tdsMinor,
          absorbedLegacyMinor: claim.absorbedLegacyMinor,
          unratedSessions: claim.unratedSessions,
          otherCurrencySessions: claim.otherCurrencySessions,
        },
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch payouts" });
  }
});

// Claims every unbilled session. `amountMinor` is the amount the trainer was shown;
// if the balance moved since (new attendance, a rate change) the request is refused.
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

    const currency = instructor.payoutCurrency || "INR";
    const open = await InstructorPayout.exists({ instructorId: req.instructor.id, status: { $in: OPEN_PAYOUT_STATUSES } });
    if (open)
      return res.status(409).json({ success: false, message: "You already have a payout request in progress" });

    const claim = await computePayoutClaim(req.instructor.id, currency);
    if (claim.amountMinor <= 0)
      return res.status(400).json({ success: false, message: "There is nothing to request yet" });
    if (claim.amountMinor !== amountMinor)
      return res.status(409).json({ success: false, message: "Your available balance has changed. Refresh and try again." });

    let payout;
    try {
      payout = await InstructorPayout.create({
        instructorId: req.instructor.id,
        amountMinor: claim.amountMinor,
        currency,
        periodStart: claim.periodStart,
        periodEnd: claim.periodEnd,
        ledger: true,
        lines: claim.lines,
        grossMinor: claim.grossMinor,
        tdsPercent: claim.tdsPercent,
        tdsMinor: claim.tdsMinor,
        absorbedLegacyMinor: claim.absorbedLegacyMinor,
        openKey: openPayoutKey(req.instructor.id),
        payoutMethod: instructor.payoutMethod,
        payoutLastFour: instructor.payoutLastFour,
        payoutDetailsSnapshotEncrypted: instructor.payoutDetailsEncrypted,
      });
    } catch (err) {
      // A concurrent request won the race for this trainer's open slot.
      if (err?.code === 11000)
        return res.status(409).json({ success: false, message: "You already have a payout request in progress" });
      throw err;
    }

    sendEmail({
      from: fromAddresses.careers,
      to: process.env.MAIL_TO,
      subject: `Payout requested by ${instructor.name}`,
      html: payoutRequestedEmail(instructor.name, (claim.amountMinor / 100).toFixed(2), currency),
    }).catch(() => {});

    const data = payout.toObject();
    delete data.payoutDetailsSnapshotEncrypted;
    delete data.openKey;
    return res.status(201).json({ success: true, data });
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
