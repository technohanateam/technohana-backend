import Bull from "bull";
import { redisConfig } from "../../config/redis.js";
import { SINGLE_RUN_RETRY_CONFIG } from "../seoIntelQueue.js";
import { runGenerationPipeline, retryFromStep } from "./adCreativeGenerationOrchestrator.service.js";
import AdCreativeGenerationJob from "../../models/adCreativeFactory/adCreativeGenerationJob.model.js";
import AdCreativeOpportunity from "../../models/adCreativeFactory/adCreativeOpportunity.model.js";

// Mirrors contentGenerationQueue.js's Bull setup pattern — own queue
// name/bucket, kept independent so a stuck ad-creative job never affects
// Content Factory's queue or budget.
const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 10 * 60 * 1000 } };

export const adCreativeFactoryQueue = new Bull("ad-creative-factory-generation", { redis: redisConfig, ...QUEUE_SETTINGS });

adCreativeFactoryQueue.process(async (job) => {
  const { opportunityId, jobId, retryStep, briefMode, skipBrandVoice } = job.data;
  if (retryStep) {
    return retryFromStep(jobId, retryStep);
  }
  return runGenerationPipeline(opportunityId, jobId, { briefMode, skipBrandVoice });
});

adCreativeFactoryQueue.on("completed", (job) => console.log(`[ad-creative-factory-generation] job ${job.id} completed`));
adCreativeFactoryQueue.on("failed", (job, err) => console.error(`[ad-creative-factory-generation] job ${job.id} failed:`, err.message));
// Bull retries a stalled job up to maxStalledCount (2) times before giving up
// silently — mark the underlying doc FAILED here so the admin sees a
// terminal, retryable state instead of a silent freeze.
adCreativeFactoryQueue.on("stalled", async (job) => {
  console.warn(`[ad-creative-factory-generation] job ${job.id} stalled, will be reclaimed`);
  const jobId = job.data?.jobId;
  if (!jobId) return;
  try {
    const genJob = await AdCreativeGenerationJob.findById(jobId);
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

    const opportunity = await AdCreativeOpportunity.findById(genJob.opportunityId);
    if (opportunity) {
      opportunity.status = "FAILED";
      opportunity.errorMessage = "Generation stalled — lock expired, likely a hung external call.";
      opportunity.retryCount = (opportunity.retryCount || 0) + 1;
      opportunity.lastAttemptAt = new Date();
      await opportunity.save();
    }
  } catch (err) {
    console.error(`[ad-creative-factory-generation] failed to persist stalled state for job ${jobId}:`, err.message);
  }
});
adCreativeFactoryQueue.on("error", (err) => console.error("[ad-creative-factory-generation] connection error:", err.message));

export function enqueueGeneration(opportunityId, jobId, { briefMode, skipBrandVoice } = {}) {
  return adCreativeFactoryQueue.add({ opportunityId, jobId, briefMode, skipBrandVoice }, { ...SINGLE_RUN_RETRY_CONFIG, attempts: 1 });
}

export function enqueueRetry(jobId, retryStep) {
  return adCreativeFactoryQueue.add({ jobId, retryStep }, { ...SINGLE_RUN_RETRY_CONFIG, attempts: 1 });
}
