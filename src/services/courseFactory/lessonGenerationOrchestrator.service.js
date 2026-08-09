import AcademyLesson from "../../models/courseFactory/academyLesson.model.js";
import AcademyCourse from "../../models/courseFactory/academyCourse.model.js";
import AcademyModule from "../../models/courseFactory/academyModule.model.js";
import LessonGenerationJob from "../../models/courseFactory/lessonGenerationJob.model.js";
import { generateLessonContent } from "./lessonContentGenerator.service.js";
import { generateAndUploadPptx } from "./pptxGenerator.service.js";
import { generateLessonAudio } from "./ttsService.js";
import { runLessonQa } from "./qaService.js";
import { enforceBudgetOrPause, estimateCostUsd } from "./budgetGuard.service.js";

// Mirrors contentGenerationOrchestrator.service.js's step-ledger pattern
// (spec §31 idempotency: only PENDING/FAILED steps re-run on "Generate
// Missing Assets"; a full regenerate is a distinct, explicit action per step).
const STEP_ORDER = ["CONTENT", "SLIDES", "NARRATION", "AUDIO", "QUIZ", "EXERCISE", "INSTRUCTOR_NOTES", "TRANSCRIPT", "QA"];

function ensureSteps(job) {
  if (!job.steps || job.steps.length === 0) {
    job.steps = STEP_ORDER.map((name) => ({ name, status: "PENDING" }));
  }
  return job;
}
function getStep(job, name) {
  return job.steps.find((s) => s.name === name);
}
async function markStepRunning(job, name) {
  const step = getStep(job, name);
  step.status = "RUNNING";
  step.startedAt = new Date();
  step.error = null;
  await job.save();
}
async function markStepDone(job, name, { model, usage } = {}) {
  const step = getStep(job, name);
  step.status = "DONE";
  step.finishedAt = new Date();
  step.model = model || null;
  const tokensIn = usage?.input_tokens || 0;
  const tokensOut = usage?.output_tokens || 0;
  step.tokensIn = tokensIn;
  step.tokensOut = tokensOut;
  step.estimatedCostUsd = model ? estimateCostUsd(model, tokensIn, tokensOut) : 0;
  job.totalTokens += tokensIn + tokensOut;
  job.totalCostUsd += step.estimatedCostUsd;
  await job.save();
}
async function markStepFailed(job, name, error) {
  const step = getStep(job, name);
  step.status = "FAILED";
  step.finishedAt = new Date();
  step.error = String(error?.message || error).slice(0, 1000);
  await job.save();
}

// Content generation produces sections/slides/quiz/exercise/instructorNotes/
// transcript in ONE Claude call (spec doesn't require separate calls per
// field, just separate regeneration entry points — which retryFromStep
// already gives us at the step granularity that matters to the admin UI:
// CONTENT/SLIDES/QUIZ/etc. all show individual status, even though CONTENT
// populates them together on first generation). SLIDES/QUIZ/EXERCISE/
// INSTRUCTOR_NOTES/TRANSCRIPT steps are marked DONE alongside CONTENT unless
// individually regenerated later via regenerateLessonComponent().
async function runSteps({ lesson, job, fromIndex }) {
  const startedAt = Date.now();

  for (let i = fromIndex; i < STEP_ORDER.length; i++) {
    const stepName = STEP_ORDER[i];
    try {
      await markStepRunning(job, stepName);

      if (stepName === "CONTENT") {
        const course = await AcademyCourse.findById(lesson.courseId).lean();
        const module = await AcademyModule.findById(lesson.moduleId).lean();
        const result = await generateLessonContent({ course, module, lesson });
        const c = result.content;
        lesson.learningObjectives = c.learningObjectives || [];
        lesson.sections = c.sections || [];
        lesson.slides = c.slides || [];
        lesson.quiz = c.quiz || [];
        lesson.exercise = c.exercise || {};
        lesson.lab = c.lab || {};
        lesson.instructorNotes = c.instructorNotes || {};
        lesson.transcript = c.transcript || "";
        lesson.narration.script = c.transcript || "";
        lesson.costUsd.contentUsd = result.costUsd || 0;
        lesson.costUsd.totalUsd = (lesson.costUsd.contentUsd || 0) + (lesson.costUsd.audioUsd || 0);
        await lesson.save();
        await markStepDone(job, stepName, result);
        // These are produced by the same CONTENT call — mark them done too so
        // the admin UI's per-asset status reflects reality immediately.
        for (const derived of ["SLIDES", "QUIZ", "EXERCISE", "INSTRUCTOR_NOTES", "TRANSCRIPT"]) {
          await markStepDone(job, derived, result);
        }
      } else if (stepName === "NARRATION") {
        // Narration script already produced by CONTENT; this step is a no-op
        // placeholder unless individually regenerated (see regenerateLessonComponent).
        await markStepDone(job, stepName, {});
      } else if (stepName === "AUDIO") {
        const audio = await generateLessonAudio({ text: lesson.narration.script, lessonSlug: lesson.slug });
        lesson.narration.audioUrl = audio.url;
        lesson.narration.audioPublicId = audio.publicId;
        lesson.narration.voice = audio.voice;
        lesson.narration.durationSeconds = audio.durationSeconds;
        lesson.costUsd.audioUsd = audio.costUsd || 0;
        lesson.costUsd.totalUsd = (lesson.costUsd.contentUsd || 0) + (lesson.costUsd.audioUsd || 0);
        await lesson.save();
        // AUDIO has its own $/char cost (not token-based), so it's recorded
        // via a direct estimatedCostUsd assignment rather than markStepDone's
        // usual token-based estimate (which needs a model/usage pair).
        const audioStep = getStep(job, stepName);
        audioStep.status = "DONE";
        audioStep.finishedAt = new Date();
        audioStep.estimatedCostUsd = audio.costUsd || 0;
        job.totalCostUsd += audioStep.estimatedCostUsd;
        await job.save();

        const pptx = await generateAndUploadPptx(lesson);
        lesson.assets.pptxUrl = pptx.url;
        lesson.assets.pptxPublicId = pptx.publicId;
        lesson.assets.pptxVersion = (lesson.assets.pptxVersion || 0) + 1;
        await lesson.save();
      } else if (stepName === "QA") {
        const qa = runLessonQa(lesson.toObject ? lesson.toObject() : lesson);
        lesson.qa = { qualityScore: qa.qualityScore, issues: qa.issues, checkedAt: new Date() };
        lesson.status = "AI_REVIEWED";
        await lesson.save();
        await markStepDone(job, stepName, {});
      }
    } catch (err) {
      console.error(`[course-factory] lesson generation step ${stepName} failed for lesson ${lesson._id}:`, err.message);
      await markStepFailed(job, stepName, err);
      job.status = "FAILED";
      job.retryCount += 1;
      job.lastAttemptAt = new Date();
      job.durationMs = Date.now() - startedAt;
      await job.save();
      return { success: false, failedStep: stepName, error: err.message, job, lesson };
    }
  }

  job.status = "DONE";
  job.durationMs = Date.now() - startedAt;
  await job.save();
  return { success: true, job, lesson };
}

export async function runLessonGenerationPipeline(lessonId, jobId) {
  const lesson = await AcademyLesson.findById(lessonId);
  if (!lesson) return { success: false, error: "Lesson not found" };

  const budgetCheck = await enforceBudgetOrPause();
  if (budgetCheck.paused) {
    const reason = budgetCheck.reason || "Daily AI budget exceeded — Course Factory generation is paused.";
    console.warn(`[course-factory] generation blocked for lesson ${lesson._id}: ${reason}`);
    if (jobId) {
      const job = await LessonGenerationJob.findById(jobId);
      if (job) {
        ensureSteps(job);
        await markStepFailed(job, STEP_ORDER[0], new Error(reason));
        job.status = "FAILED";
        await job.save();
      }
    }
    return { success: false, failedStep: "BUDGET", error: reason, lesson };
  }

  let job = jobId ? await LessonGenerationJob.findById(jobId) : null;
  if (!job) job = new LessonGenerationJob({ lessonId, status: "RUNNING", steps: [] });
  else job.status = "RUNNING";
  ensureSteps(job);
  await job.save();

  return runSteps({ lesson, job, fromIndex: 0 });
}

// Re-runs only from the given step onward — used by "Generate Missing Assets"
// (targets the first FAILED/PENDING step) and by explicit per-component
// regenerate buttons (spec §28/§31).
export async function retryLessonFromStep(jobId, stepName) {
  const job = await LessonGenerationJob.findById(jobId);
  if (!job) return { success: false, error: "Job not found" };
  const lesson = await AcademyLesson.findById(job.lessonId);
  if (!lesson) return { success: false, error: "Lesson not found" };

  ensureSteps(job);
  const targetName = stepName || job.steps.find((s) => s.status === "FAILED")?.name || STEP_ORDER[0];
  const fromIndex = STEP_ORDER.indexOf(targetName);
  if (fromIndex === -1) return { success: false, error: `Unknown step: ${targetName}` };

  const budgetCheck = await enforceBudgetOrPause();
  if (budgetCheck.paused) {
    const reason = budgetCheck.reason || "Daily AI budget exceeded — Course Factory generation is paused.";
    await markStepFailed(job, targetName, new Error(reason));
    job.status = "FAILED";
    await job.save();
    return { success: false, failedStep: "BUDGET", error: reason, lesson };
  }

  job.steps.forEach((s) => {
    if (STEP_ORDER.indexOf(s.name) >= fromIndex) {
      s.status = "PENDING";
      s.error = null;
    }
  });
  job.status = "RUNNING";
  await job.save();

  return runSteps({ lesson, job, fromIndex });
}
