import AcademyLesson from "../../models/courseFactory/academyLesson.model.js";
import { runLessonQa } from "../../services/courseFactory/qaService.js";

// GET /admin/course-factory/lessons/:id
export const getLesson = async (req, res) => {
  try {
    const lesson = await AcademyLesson.findById(req.params.id).lean();
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });
    return res.json({ success: true, data: lesson });
  } catch (err) {
    console.error("[CourseFactory] getLesson error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PATCH /admin/course-factory/lessons/:id
// Admin-editable fields only (spec §27 lesson editor) — never lets the
// client set status/assets/qa directly, those flow through their own routes.
const EDITABLE_FIELDS = [
  "title", "description", "durationMinutes", "learningObjectives", "sections",
  "slides", "narration", "quiz", "exercise", "lab", "resources", "sources",
  "instructorNotes", "transcript",
];

// Source verification must only ever change through the dedicated
// verify/unverify route below (requireAdmin-gated, audit-stamped). If a
// caller PATCHes a new `sources` array through this general-purpose route,
// strip any verification fields from it and reattach whatever the lesson
// already had for that source (matched by _id) — closes an otherwise-open
// bypass where requireMarketing (broader-trust) callers could self-verify
// sources through the generic edit endpoint.
function preserveSourceVerification(existingSources, incomingSources) {
  const existingById = new Map((existingSources || []).map((s) => [String(s._id), s]));
  return (incomingSources || []).map((incoming) => {
    const existing = incoming._id ? existingById.get(String(incoming._id)) : null;
    return {
      ...incoming,
      verificationStatus: existing?.verificationStatus || "PENDING_VERIFICATION",
      verifiedBy: existing?.verifiedBy || null,
      verifiedAt: existing?.verifiedAt || null,
    };
  });
}

export const updateLesson = async (req, res) => {
  try {
    const lesson = await AcademyLesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });
    if (lesson.status === "PUBLISHED") {
      return res.status(409).json({ success: false, message: "Editing a published lesson creates a new draft version — not yet supported; unpublish first." });
    }

    for (const field of EDITABLE_FIELDS) {
      if (req.body?.[field] === undefined) continue;
      if (field === "sources") {
        lesson.sources = preserveSourceVerification(lesson.sources, req.body.sources);
        continue;
      }
      lesson[field] = req.body[field];
    }
    lesson.version += 1;
    await lesson.save();
    return res.json({ success: true, data: lesson, message: "Lesson updated" });
  } catch (err) {
    console.error("[CourseFactory] updateLesson error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/course-factory/lessons/:id/sources/:sourceId/verify
// POST /admin/course-factory/lessons/:id/sources/:sourceId/unverify
// The only path that may ever set verificationStatus: VERIFIED — gated
// requireAdmin at the route level (spec: "Only authorized Course Factory
// administrators can change verification status"). Never marks a source
// VERIFIED automatically; a human must click it. Re-runs QA immediately
// afterward so publishReady reflects the change without a separate step.
export const setSourceVerification = async (req, res, verified) => {
  try {
    const lesson = await AcademyLesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });

    const source = lesson.sources.id(req.params.sourceId);
    if (!source) return res.status(404).json({ success: false, message: "Source not found" });

    if (verified) {
      source.verificationStatus = "VERIFIED";
      source.verifiedBy = req.admin?.email || req.admin?.uid || "unknown-admin";
      source.verifiedAt = new Date();
    } else {
      source.verificationStatus = "PENDING_VERIFICATION";
      source.verifiedBy = null;
      source.verifiedAt = null;
    }

    const qa = runLessonQa(lesson.toObject());
    lesson.qa = { qualityScore: qa.qualityScore, issues: qa.issues, publishReady: qa.publishReady, checkedAt: new Date() };
    await lesson.save();

    return res.json({ success: true, data: { source, qa: lesson.qa }, message: verified ? "Source marked verified" : "Source reverted to pending verification" });
  } catch (err) {
    console.error("[CourseFactory] setSourceVerification error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const verifySource = (req, res) => setSourceVerification(req, res, true);
export const unverifySource = (req, res) => setSourceVerification(req, res, false);

// POST /admin/course-factory/lessons/:id/qa
// Runs the QA gate synchronously (pure function, no AI call) and persists it.
export const runQa = async (req, res) => {
  try {
    const lesson = await AcademyLesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });

    const qa = runLessonQa(lesson.toObject());
    lesson.qa = { qualityScore: qa.qualityScore, issues: qa.issues, publishReady: qa.publishReady, checkedAt: new Date() };
    if (lesson.status === "DRAFT") lesson.status = "AI_REVIEWED";
    await lesson.save();

    return res.json({ success: true, data: lesson.qa, message: qa.passed ? "QA passed" : `QA found ${qa.issues.length} issue(s)` });
  } catch (err) {
    console.error("[CourseFactory] runQa error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/course-factory/lessons/:id/submit-review
// AI_REVIEWED -> HUMAN_REVIEW (spec §23 status ladder).
export const submitForReview = async (req, res) => {
  try {
    const lesson = await AcademyLesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });
    if (lesson.status !== "AI_REVIEWED") {
      return res.status(409).json({ success: false, message: `Cannot submit for review from status ${lesson.status}. Run QA first.` });
    }
    lesson.status = "HUMAN_REVIEW";
    await lesson.save();
    return res.json({ success: true, message: "Submitted for human review" });
  } catch (err) {
    console.error("[CourseFactory] submitForReview error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/course-factory/lessons/:id/approve
// HUMAN_REVIEW -> APPROVED. Requires admin role (destructive/publishing-path
// action) — wired via requireAdmin in the route.
export const approveLesson = async (req, res) => {
  try {
    const lesson = await AcademyLesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });
    if (lesson.status !== "HUMAN_REVIEW") {
      return res.status(409).json({ success: false, message: `Cannot approve from status ${lesson.status}.` });
    }
    lesson.status = "APPROVED";
    lesson.approvedAt = new Date();
    await lesson.save();
    return res.json({ success: true, message: "Lesson approved" });
  } catch (err) {
    console.error("[CourseFactory] approveLesson error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/course-factory/lessons/:id/publish
// APPROVED -> PUBLISHED. Never publishes unreviewed AI content (spec §23
// non-negotiable rule #8) — the APPROVED gate above is what enforces that.
export const publishLesson = async (req, res) => {
  try {
    const lesson = await AcademyLesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });
    if (lesson.status !== "APPROVED") {
      return res.status(409).json({ success: false, message: `Cannot publish from status ${lesson.status}. Must be APPROVED.` });
    }
    if (lesson.qa?.publishReady === false) {
      return res.status(409).json({ success: false, message: "Cannot publish — sources are missing or still PENDING_VERIFICATION. Verify sources, then re-run QA before publishing." });
    }
    lesson.status = "PUBLISHED";
    lesson.publishedAt = new Date();
    await lesson.save();

    return res.json({ success: true, message: "Lesson published to the Academy" });
  } catch (err) {
    console.error("[CourseFactory] publishLesson error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
