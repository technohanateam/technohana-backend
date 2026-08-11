import AcademyLesson from "../../models/courseFactory/academyLesson.model.js";
import LessonGenerationJob from "../../models/courseFactory/lessonGenerationJob.model.js";
import { enqueueLessonGeneration, enqueueLessonRetry } from "../../services/courseFactory/courseFactoryQueue.js";

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

// POST /admin/course-factory/lessons/:id/regenerate
// Body: { step: "NARRATION" } — explicit single-component regenerate
// (spec §28: regenerate narration without touching slides, etc).
export const regenerateLessonComponent = async (req, res) => {
  try {
    const { step } = req.body || {};
    const validSteps = ["CONTENT", "SLIDES", "NARRATION", "AUDIO", "QUIZ", "EXERCISE", "INSTRUCTOR_NOTES", "TRANSCRIPT", "QA"];
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
