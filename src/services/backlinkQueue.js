import Bull from "bull";
import { runVerificationBatch } from "./backlinkVerificationService.js";
import { redisConfig } from "../config/redis.js";
import { SINGLE_RUN_RETRY_CONFIG } from "./seoIntelQueue.js";

// Mirrors the seoIntelQueue.js pattern exactly — same settings, same retry
// presets (imported, not redefined) — for the Phase 6 backlink automation jobs.
const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 5 * 60 * 1000 } };

export const backlinkVerificationQueue = new Bull("backlink-verification", { redis: redisConfig, ...QUEUE_SETTINGS });

backlinkVerificationQueue.process(async (job) => {
  return runVerificationBatch({ ids: job.data?.ids });
});

for (const [name, queue] of Object.entries({ backlinkVerificationQueue })) {
  queue.on("completed", (job) => console.log(`[${name}] job ${job.id} completed`));
  queue.on("failed", (job, err) => console.error(`[${name}] job ${job.id} failed:`, err.message));
  queue.on("stalled", (job) => console.warn(`[${name}] job ${job.id} stalled, will be reclaimed`));
  queue.on("error", (err) => console.error(`[${name}] connection error:`, err.message));
}

// Bull dedupes repeatables by cron+data automatically, so calling this on
// every boot is safe and keeps the schedule declared in one place.
export async function scheduleBacklinkRepeatables() {
  await backlinkVerificationQueue.add({}, { repeat: { cron: "0 7 * * 1" }, ...SINGLE_RUN_RETRY_CONFIG }); // weekly, Monday 7am
}
