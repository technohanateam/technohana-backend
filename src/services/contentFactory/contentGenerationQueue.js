import Bull from "bull";
import { redisConfig } from "../../config/redis.js";
import { SINGLE_RUN_RETRY_CONFIG } from "../seoIntelQueue.js";
import { runGenerationPipeline, retryFromStep } from "./contentGenerationOrchestrator.service.js";
import ContentGenerationJob from "../../models/contentGenerationJob.model.js";
import ContentOpportunity from "../../models/contentOpportunity.model.js";

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
// Bull retries a stalled job up to maxStalledCount (2) times before giving up
// silently — if the underlying hang (e.g. a stuck external API call) repeats
// on every attempt, the ContentGenerationJob doc is otherwise left at status
// RUNNING forever with no error ever recorded. Mark it FAILED here so the
// admin sees a terminal, retryable state instead of a silent freeze.
contentGenerationQueue.on("stalled", async (job) => {
  console.warn(`[content-factory-generation] job ${job.id} stalled, will be reclaimed`);
  const jobId = job.data?.jobId;
  if (!jobId) return;
  try {
    const genJob = await ContentGenerationJob.findById(jobId);
    if (!genJob || !["QUEUED", "RUNNING"].includes(genJob.status)) return;

    const runningStep = genJob.steps.find((s) => s.status === "RUNNING");
    if (runningStep) {
      runningStep.status = "FAILED";
      runningStep.finishedAt = new Date();
      runningStep.error = "Generation stalled — lock expired, likely a hung external call.";
    }
    genJob.status = "FAILED";
    genJob.pendingStep = null;
    genJob.pendingPrompts = [];
    genJob.retryCount += 1;
    genJob.lastAttemptAt = new Date();
    await genJob.save();

    const opportunity = await ContentOpportunity.findById(genJob.opportunityId);
    if (opportunity) {
      opportunity.status = "FAILED";
      opportunity.errorMessage = "Generation stalled — lock expired, likely a hung external call.";
      opportunity.retryCount = (opportunity.retryCount || 0) + 1;
      opportunity.lastAttemptAt = new Date();
      await opportunity.save();
    }
  } catch (err) {
    console.error(`[content-factory-generation] failed to persist stalled state for job ${jobId}:`, err.message);
  }
});
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
