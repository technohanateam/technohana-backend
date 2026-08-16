import Bull from "bull";
import { redisConfig } from "../../config/redis.js";
import { SINGLE_RUN_RETRY_CONFIG } from "../seoIntelQueue.js";
import { runGenerationPipeline, retryFromStep } from "./contentGenerationOrchestrator.service.js";

// Mirrors contentFactoryQueue.js's (M1) Bull setup pattern — same redisConfig,
// same imported retry preset, own queue name/bucket per generation job.
const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 10 * 60 * 1000 } };

export const contentGenerationQueue = new Bull("content-factory-generation", { redis: redisConfig, ...QUEUE_SETTINGS });

contentGenerationQueue.process(async (job) => {
  const { opportunityId, jobId, retryStep, briefMode } = job.data;
  if (retryStep) {
    return retryFromStep(jobId, retryStep);
  }
  return runGenerationPipeline(opportunityId, jobId, { briefMode });
});

contentGenerationQueue.on("completed", (job) => console.log(`[content-factory-generation] job ${job.id} completed`));
contentGenerationQueue.on("failed", (job, err) => console.error(`[content-factory-generation] job ${job.id} failed:`, err.message));
contentGenerationQueue.on("stalled", (job) => console.warn(`[content-factory-generation] job ${job.id} stalled, will be reclaimed`));
contentGenerationQueue.on("error", (err) => console.error("[content-factory-generation] connection error:", err.message));

// `jobId` is the caller's already-created ContentGenerationJob._id, so the
// pipeline operates on the exact doc the caller got back — without it, a
// double-submit (two generate/regenerate calls close together) could create
// two QUEUED job docs and have the orchestrator's own most-recent lookup
// silently update the wrong one.
export function enqueueGeneration(opportunityId, jobId, { briefMode } = {}) {
  return contentGenerationQueue.add({ opportunityId, jobId, briefMode }, { ...SINGLE_RUN_RETRY_CONFIG, attempts: 1 });
}

export function enqueueRetry(jobId, retryStep) {
  return contentGenerationQueue.add({ jobId, retryStep }, { ...SINGLE_RUN_RETRY_CONFIG, attempts: 1 });
}
