import Bull from "bull";
import { redisConfig } from "../../config/redis.js";
import { SINGLE_RUN_RETRY_CONFIG } from "../seoIntelQueue.js";
import { runLessonGenerationPipeline, retryLessonFromStep } from "./lessonGenerationOrchestrator.service.js";

// Same Bull setup as contentGenerationQueue.js — shared redisConfig, shared
// retry preset, own queue name/bucket for lesson generation jobs.
const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 15 * 60 * 1000 } };

export const courseFactoryQueue = new Bull("course-factory-lesson-generation", { redis: redisConfig, ...QUEUE_SETTINGS });

courseFactoryQueue.process(async (job) => {
  const { lessonId, jobId, retryStep } = job.data;
  if (retryStep) return retryLessonFromStep(jobId, retryStep);
  return runLessonGenerationPipeline(lessonId, jobId);
});

courseFactoryQueue.on("completed", (job) => console.log(`[course-factory] job ${job.id} completed`));
courseFactoryQueue.on("failed", (job, err) => console.error(`[course-factory] job ${job.id} failed:`, err.message));
courseFactoryQueue.on("stalled", (job) => console.warn(`[course-factory] job ${job.id} stalled, will be reclaimed`));
courseFactoryQueue.on("error", (err) => console.error("[course-factory] connection error:", err.message));

// `jobId` is the caller's already-created LessonGenerationJob._id (same
// double-submit-safety rationale as contentGenerationQueue.js).
export function enqueueLessonGeneration(lessonId, jobId) {
  return courseFactoryQueue.add({ lessonId, jobId }, { ...SINGLE_RUN_RETRY_CONFIG, attempts: 1 });
}

export function enqueueLessonRetry(jobId, retryStep) {
  return courseFactoryQueue.add({ jobId, retryStep }, { ...SINGLE_RUN_RETRY_CONFIG, attempts: 1 });
}
