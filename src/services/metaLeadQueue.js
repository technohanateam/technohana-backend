import Bull from "bull";
import { redisConfig } from "../config/redis.js";
import { processMetaLeadgen } from "./metaLeadAds.js";

const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 2 * 60 * 1000 } };

export const metaLeadQueue = new Bull("meta-leads", { redis: redisConfig, ...QUEUE_SETTINGS });

metaLeadQueue.process(async (job) => processMetaLeadgen(job.data));

metaLeadQueue.on("completed", (job, result) => {
  if (result?.created) console.log(`[meta-leads] leadgen ${job.data.leadgenId} → lead ${result.leadId}`);
});
metaLeadQueue.on("failed", (job, err) =>
  console.error(`[meta-leads] leadgen ${job.data.leadgenId} attempt ${job.attemptsMade} failed:`, err.message));
metaLeadQueue.on("error", (err) => console.error("[meta-leads] connection error:", err.message));

// The jobId collapses concurrent redeliveries of the same lead into one job; retries
// back off exponentially (30s, 1m, 2m, …) to ride out Graph API hiccups.
export const enqueueMetaLeadgen = (event) =>
  metaLeadQueue.add(event, {
    jobId: `leadgen-${event.leadgenId}`,
    attempts: 5,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
