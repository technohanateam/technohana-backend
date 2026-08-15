import AcademyLesson from "../../models/courseFactory/academyLesson.model.js";
import LessonGenerationJob from "../../models/courseFactory/lessonGenerationJob.model.js";
import { enqueueLessonGeneration, enqueueLessonRetry } from "../../services/courseFactory/courseFactoryQueue.js";
import { resumeLessonContent } from "../../services/courseFactory/lessonGenerationOrchestrator.service.js";

// POST /admin/course-factory/lessons/:id/generate
// Enqueues the full generation pipeline for one lesson. Frontend polls
// GET /jobs/:id for progress (spec §30 job-queue statuses).
export const generateLesson = async (req, res) => {
  try {
    const lesson = await AcademyLesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });

    const job = await LessonGenerationJob.create({ lessonId: lesson._id, status: "QUEUED" });
    await enqueueLessonGeneration(lesson._id.toString(), job._id.toString());

    return res.json({ success: true, data: { jobId: job._id }, message: "Lesson generation queued" });
  } catch (err) {
    console.error("[CourseFactory] generateLesson error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/course-factory/jobs/:id/resume-content
// body: { text } — the admin's pasted Claude Pro response to the CONTENT
// step's prompt (job.pendingPrompts, set while job.status === AWAITING_INPUT).
// Manual Claude Pro workflow — mirrors Content Factory's
// POST /jobs/:id/submit-step after fda0261 (ANTHROPIC_API_KEY has no working
// billing, so this pipeline no longer calls the API directly).
export const resumeContentStep = async (req, res) => {
  try {
    const job = await LessonGenerationJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    if (job.status !== "AWAITING_INPUT") {
      return res.status(409).json({ success: false, message: `Job is not awaiting input (status: ${job.status})` });
    }

    const result = await resumeLessonContent(job._id.toString(), req.body?.text);
    if (!result.success && !result.awaitingInput) {
      return res.status(400).json({ success: false, message: result.error || "Failed to resume step" });
    }

    return res.json({ success: true, data: { job: result.job, lesson: result.lesson }, message: result.awaitingInput ? "Awaiting next input" : "Step resumed" });
  } catch (err) {
    console.error("[CourseFactory] resumeContentStep error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /admin/course-factory/jobs/:id
export const getGenerationJob = async (req, res) => {
  try {
    const job = await LessonGenerationJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    return res.json({ success: true, data: job });
  } catch (err) {
    console.error("[CourseFactory] getGenerationJob error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /admin/course-factory/lessons/:id/jobs
export const listLessonJobs = async (req, res) => {
  try {
    const jobs = await LessonGenerationJob.find({ lessonId: req.params.id }).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: jobs });
  } catch (err) {
    console.error("[CourseFactory] listLessonJobs error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/course-factory/jobs/:id/retry
// Body: { step?: "AUDIO" } — omit to retry the first FAILED step
// ("Generate Missing Assets" per spec §31 — never re-runs DONE steps).
export const retryGenerationJob = async (req, res) => {
  try {
    const job = await LessonGenerationJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    if (["QUEUED", "RUNNING"].includes(job.status)) {
      return res.status(409).json({ success: false, message: `Cannot retry — job is already ${job.status}.` });
    }

    const step = req.body?.step || job.steps.find((s) => s.status === "FAILED")?.name;
    if (!step) return res.status(400).json({ success: false, message: "No failed step to retry" });

    await enqueueLessonRetry(job._id.toString(), step);
    return res.json({ success: true, data: { jobId: job._id, step }, message: "Retry queued" });
  } catch (err) {
    console.error("[CourseFactory] retryGenerationJob error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/course-factory/lessons/:id/slides/:slideOrder/regenerate-audio
// Force-regenerates ONE slide's audio even if it already succeeded — distinct
// from the failure-driven "Generate Missing Assets" retry (which skips DONE
// slides). :slideOrder is the slide's `order` field, not its array position.
export const regenerateSlideAudio = async (req, res) => {
  try {
    const slideOrder = Number(req.params.slideOrder);
    if (!Number.isInteger(slideOrder) || slideOrder < 0) {
      return res.status(400).json({ success: false, message: "slideOrder must be a non-negative integer" });
    }

    const lesson = await AcademyLesson.findById(req.params.id).lean();
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });
    const slide = (lesson.slides || []).find((s) => s.order === slideOrder);
    if (!slide) return res.status(404).json({ success: false, message: `No slide with order ${slideOrder}` });
    if (!(slide.narration || "").trim()) {
      return res.status(409).json({ success: false, message: "This slide has no narration — nothing to generate audio for." });
    }

    const job = await LessonGenerationJob.create({ lessonId: lesson._id, status: "QUEUED" });
    await enqueueLessonRetry(job._id.toString(), "AUDIO", { slideOrder, force: true });

    return res.json({ success: true, data: { jobId: job._id, slideOrder }, message: `Regenerating audio for slide ${slideOrder}` });
  } catch (err) {
    console.error("[CourseFactory] regenerateSlideAudio error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/course-factory/lessons/:id/regenerate
// Body: { step: "NARRATION" } — explicit single-component regenerate
// (spec §28: regenerate narration without touching slides, etc).
export const regenerateLessonComponent = async (req, res) => {
  try {
    const { step } = req.body || {};
    const validSteps = ["CONTENT", "SLIDES", "NARRATION", "PPTX", "AUDIO", "QUIZ", "EXERCISE", "INSTRUCTOR_NOTES", "TRANSCRIPT", "QA"];
    if (!step || !validSteps.includes(step)) {
      return res.status(400).json({ success: false, message: `step must be one of: ${validSteps.join(", ")}` });
    }
    const lesson = await AcademyLesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });

    const job = await LessonGenerationJob.create({ lessonId: lesson._id, status: "QUEUED" });
    await enqueueLessonRetry(job._id.toString(), step);

    return res.json({ success: true, data: { jobId: job._id, step }, message: `Regenerating ${step}` });
  } catch (err) {
    console.error("[CourseFactory] regenerateLessonComponent error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
