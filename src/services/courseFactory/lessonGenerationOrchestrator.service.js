import AcademyLesson from "../../models/courseFactory/academyLesson.model.js";
import AcademyCourse from "../../models/courseFactory/academyCourse.model.js";
import AcademyModule from "../../models/courseFactory/academyModule.model.js";
import LessonGenerationJob from "../../models/courseFactory/lessonGenerationJob.model.js";
import { generateLessonContent } from "./lessonContentGenerator.service.js";
import { generateAndUploadPptx } from "./pptxGenerator.service.js";
import { generateSlideAudio, classifyTtsError } from "./ttsService.js";
import { runLessonQa } from "./qaService.js";
import { enforceBudgetOrPause, estimateCostUsd, pauseForTtsAuthFailure } from "./budgetGuard.service.js";
import { getOrCreateCourseFactorySettings } from "../../models/courseFactory/courseFactorySettings.model.js";

// Slide types that legitimately have no narration by design (title/quiz/
// exercise/transition — an interactive component or bare divider takes over)
// — mirrors qaService.js's NARRATION_REQUIRED_TYPES exclusion so a slide with
// no narration is never even attempted for audio, not silently "succeeded."
const AUDIO_SKIP_IF_EMPTY = true;

// Pure decision function: given one slide's current state and whether this is
// a forced regenerate, decide what the AUDIO loop should do with it. Exported
// so failure-isolation/idempotency behavior is unit-testable against plain
// slide objects, without needing a DB, a job, or a real TTS call.
export function decideSlideAudioAction(slide, { force = false } = {}) {
  const narration = (slide.narration || "").trim();
  if (!narration && AUDIO_SKIP_IF_EMPTY) return "SKIP_NO_NARRATION";
  if (!force && slide.audio?.status === "DONE") return "SKIP_ALREADY_DONE";
  return "GENERATE";
}

// Given the AUDIO step's stepOptions (from a single-slide force-regenerate
// request) and one slide, decides whether that slide is even in scope for
// this pass, and whether it should be forced. `targetSlideOrder === undefined`
// means "normal full-lesson pass" (every narrated slide in scope, nothing
// forced unless stepOptions.force is set for a full-lesson forced redo).
// Exported so this targeting logic — the part that's easy to get backwards
// (e.g. accidentally regenerating every slide instead of just the target) —
// is unit-testable without a DB or a real TTS call.
export function isSlideInAudioScope(slide, stepOptions) {
  const targetSlideOrder = stepOptions?.slideOrder;
  if (targetSlideOrder === undefined) return true; // full-lesson pass — every slide in scope
  return slide.order === targetSlideOrder;
}

export function shouldForceSlideAudio(slide, stepOptions) {
  const targetSlideOrder = stepOptions?.slideOrder;
  if (targetSlideOrder !== undefined) return slide.order === targetSlideOrder;
  return Boolean(stepOptions?.force);
}

// Mirrors contentGenerationOrchestrator.service.js's step-ledger pattern
// (spec §31 idempotency: only PENDING/FAILED steps re-run on "Generate
// Missing Assets"; a full regenerate is a distinct, explicit action per step).
// PPTX runs right after NARRATION (needs only lesson.slides, already set by
// CONTENT) and BEFORE AUDIO — found via a real E2E run that PPTX was
// previously generated inside the AUDIO step, so a narration/TTS failure
// silently meant no PPTX either, despite PPTX having no real dependency on
// audio succeeding.
const STEP_ORDER = ["CONTENT", "SLIDES", "NARRATION", "PPTX", "AUDIO", "QUIZ", "EXERCISE", "INSTRUCTOR_NOTES", "TRANSCRIPT", "QA"];

// Exported (not just internal) so cost-accounting logic is unit-testable
// against a plain mock job object without needing DB/queue mocking — this
// codebase has neither elsewhere, so the exported-pure-helper pattern
// (mirrors validateLessonContent's export) is how testability is achieved.
export function ensureSteps(job) {
  if (!job.steps || job.steps.length === 0) {
    job.steps = STEP_ORDER.map((name) => ({ name, status: "PENDING" }));
  }
  return job;
}
export function getStep(job, name) {
  return job.steps.find((s) => s.name === name);
}
async function markStepRunning(job, name) {
  const step = getStep(job, name);
  step.status = "RUNNING";
  step.startedAt = new Date();
  step.error = null;
  await job.save();
}
export async function markStepDone(job, name, { model, usage } = {}) {
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
async function runSteps({ lesson, job, fromIndex, stepOptions = null }) {
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
        lesson.sources = c.sources || [];
        lesson.costUsd.contentUsd = result.costUsd || 0;
        lesson.costUsd.totalUsd = (lesson.costUsd.contentUsd || 0) + (lesson.costUsd.audioUsd || 0);
        await lesson.save();
        await markStepDone(job, stepName, result);
        // These are facets of the SAME CONTENT call, not independent API
        // calls — mark them done so the admin UI's per-asset status reflects
        // reality immediately, but with an empty result (like NARRATION
        // below) so their cost is genuinely $0. Passing `result` here was a
        // real bug: it re-added the one real CONTENT call's cost 5 more
        // times into job.totalCostUsd (found via a real E2E run — the
        // budget-guard total, tracked independently at the generator call
        // site, was correct; only this job-level display total was inflated).
        for (const derived of ["SLIDES", "QUIZ", "EXERCISE", "INSTRUCTOR_NOTES", "TRANSCRIPT"]) {
          await markStepDone(job, derived, {});
        }
      } else if (stepName === "NARRATION") {
        // Narration script already produced by CONTENT; this step is a no-op
        // placeholder unless individually regenerated (see regenerateLessonComponent).
        await markStepDone(job, stepName, {});
      } else if (stepName === "PPTX") {
        const pptx = await generateAndUploadPptx(lesson);
        lesson.assets.pptxUrl = pptx.url;
        lesson.assets.pptxPublicId = pptx.publicId;
        lesson.assets.pptxVersion = (lesson.assets.pptxVersion || 0) + 1;
        await lesson.save();
        await markStepDone(job, stepName, {});
      } else if (stepName === "AUDIO") {
        let audioCostUsd = 0;
        let failedCount = 0;
        let authFailure = null;

        // A single-slide force-regenerate (admin "Regenerate" button on one
        // slide) targets only stepOptions.slideOrder and always forces that
        // one slide even if it's already DONE; every other slide keeps
        // ordinary idempotent behavior (skip DONE, retry PENDING/FAILED).
        const targetSlideOrder = stepOptions?.slideOrder;

        for (const slide of lesson.slides) {
          if (!isSlideInAudioScope(slide, stepOptions)) continue;
          const force = shouldForceSlideAudio(slide, stepOptions);
          const action = decideSlideAudioAction(slide, { force });
          if (action === "SKIP_NO_NARRATION" || action === "SKIP_ALREADY_DONE") continue;

          try {
            const audio = await generateSlideAudio({ text: slide.narration, lessonSlug: lesson.slug, slideOrder: slide.order });
            slide.audio = {
              audioUrl: audio.url,
              audioPublicId: audio.publicId,
              durationSeconds: audio.durationSeconds,
              voice: audio.voice,
              status: "DONE",
              error: null,
              costUsd: audio.costUsd || 0,
            };
            audioCostUsd += audio.costUsd || 0;
            job.totalCostUsd += audio.costUsd || 0;
          } catch (err) {
            const classification = classifyTtsError(err);
            slide.audio = slide.audio || {};
            slide.audio.status = "FAILED";
            slide.audio.error = String(err?.message || err).slice(0, 500);
            failedCount += 1;
            console.error(`[course-factory] audio failed for lesson ${lesson._id} slide ${slide.order} (${classification}):`, err.message);

            // Fail-fast only on AUTH_FAILURE — repeating the same invalid-key
            // failure across every remaining slide is pure noise; other
            // classifications (rate limit, transient, unknown) are isolated
            // to this one slide and the loop continues.
            if (classification === "AUTH_FAILURE") {
              authFailure = err;
              break;
            }
          }
        }

        const narratedSlides = lesson.slides.filter((s) => (s.narration || "").trim());
        lesson.narration.audioSummary = {
          totalSlides: narratedSlides.length,
          slidesWithAudio: narratedSlides.filter((s) => s.audio?.status === "DONE").length,
          totalDurationSeconds: narratedSlides.reduce((sum, s) => sum + (s.audio?.durationSeconds || 0), 0),
          allComplete: narratedSlides.length > 0 && narratedSlides.every((s) => s.audio?.status === "DONE"),
        };
        lesson.costUsd.audioUsd = narratedSlides.reduce((sum, s) => sum + (s.audio?.costUsd || 0), 0);
        lesson.costUsd.totalUsd = (lesson.costUsd.contentUsd || 0) + (lesson.costUsd.audioUsd || 0);
        await lesson.save();

        if (authFailure) {
          await pauseForTtsAuthFailure(`Lesson ${lesson._id} (${lesson.slug}), slide audio generation.`);
        }

        // AUDIO step's own status reflects the per-slide rollup — DONE only
        // if every narrated slide succeeded, else FAILED with a summary
        // message (per-slide detail lives on slides[i].audio.error).
        const audioStep = getStep(job, stepName);
        audioStep.finishedAt = new Date();
        // Single-slide retry didn't zero the step's prior cost (see
        // retryLessonFromStep), so add this run's cost on top of whatever
        // was already there instead of overwriting it.
        audioStep.estimatedCostUsd = targetSlideOrder !== undefined ? (audioStep.estimatedCostUsd || 0) + audioCostUsd : audioCostUsd;
        if (failedCount === 0) {
          audioStep.status = "DONE";
          audioStep.error = null;
        } else {
          audioStep.status = "FAILED";
          audioStep.error = authFailure
            ? `TTS authentication failed — generation paused. ${failedCount} of ${narratedSlides.length} slide(s) failed.`
            : `${failedCount} of ${narratedSlides.length} slide(s) failed to generate audio.`;
        }
        await job.save();

        if (authFailure) {
          job.status = "FAILED";
          job.retryCount += 1;
          job.lastAttemptAt = new Date();
          job.durationMs = Date.now() - startedAt;
          await job.save();
          return { success: false, failedStep: stepName, error: "TTS authentication failed", job, lesson };
        }
        if (failedCount > 0) {
          job.status = "FAILED";
          job.retryCount += 1;
          job.lastAttemptAt = new Date();
          job.durationMs = Date.now() - startedAt;
          await job.save();
          return { success: false, failedStep: stepName, error: audioStep.error, job, lesson };
        }
      } else if (stepName === "QA") {
        // Non-blocking fetch — same philosophy as other settings reads in
        // this pipeline; a transient DB hiccup falls back to the default
        // rather than failing the whole QA step.
        let narrationWordsPerMinute = 150;
        try {
          narrationWordsPerMinute = (await getOrCreateCourseFactorySettings()).narrationWordsPerMinute || 150;
        } catch (err) {
          console.error("[CourseFactory] could not load narrationWordsPerMinute setting, using default 150:", err.message);
        }
        const qa = runLessonQa(lesson.toObject ? lesson.toObject() : lesson, { narrationWordsPerMinute });
        lesson.qa = { qualityScore: qa.qualityScore, issues: qa.issues, publishReady: qa.publishReady, durationReport: qa.durationReport, checkedAt: new Date() };
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
export async function retryLessonFromStep(jobId, stepName, stepOptions = null) {
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

  // Subtract each reset step's already-counted cost/tokens from the job
  // totals BEFORE zeroing it and re-running — otherwise a retry compounds on
  // top of the prior attempt's cost instead of replacing it (found via the
  // same E2E run as the 6x CONTENT-cost bug above).
  //
  // Exception: a single-slide targeted retry (stepOptions.slideOrder set)
  // only re-generates that one slide — the AUDIO step's job-level cost still
  // covers every other already-succeeded slide, so it must NOT be zeroed
  // here. The AUDIO branch's own loop adds the one re-generated slide's new
  // cost back in as it runs, same as any other slide.
  const isSingleSlideAudioRetry = targetName === "AUDIO" && stepOptions?.slideOrder !== undefined;
  job.steps.forEach((s) => {
    if (STEP_ORDER.indexOf(s.name) >= fromIndex) {
      if (s.name === "AUDIO" && isSingleSlideAudioRetry) return;
      job.totalCostUsd = Math.max(0, job.totalCostUsd - (s.estimatedCostUsd || 0));
      job.totalTokens = Math.max(0, job.totalTokens - ((s.tokensIn || 0) + (s.tokensOut || 0)));
      s.status = "PENDING";
      s.error = null;
      s.model = null;
      s.tokensIn = 0;
      s.tokensOut = 0;
      s.estimatedCostUsd = 0;
    }
  });
  job.status = "RUNNING";
  await job.save();

  return runSteps({ lesson, job, fromIndex, stepOptions });
}
