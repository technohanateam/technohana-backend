import Bull from "bull";
import { redisConfig } from "../../config/redis.js";
import { SYNC_RETRY_CONFIG } from "../seoIntelQueue.js";
import { runDailyPlanningJob } from "./dailyPlanningJob.processor.js";

// Mirrors the backlinkQueue.js/seoIntelQueue.js pattern — same settings,
// imported retry preset (not redefined).
const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 5 * 60 * 1000 } };

export const contentFactoryPlanningQueue = new Bull("content-factory-planning", { redis: redisConfig, ...QUEUE_SETTINGS });

// Milestone 4: the full daily planning sequence (PAUSED check, budget guard,
// priority refresh, trend/gap stubs, candidate generation, optional
// auto-generation) now lives in dailyPlanningJob.processor.js — this
// processor just calls it, preserving the PAUSED-check-first behavior that
// used to be inlined here (absorbed into the processor module, not
// duplicated).
contentFactoryPlanningQueue.process(async (job) => {
  return runDailyPlanningJob({ triggeredBy: job.data?.triggeredBy || "CRON" });
});

contentFactoryPlanningQueue.on("completed", (job) => console.log(`[content-factory-planning] job ${job.id} completed`));
contentFactoryPlanningQueue.on("failed", (job, err) => console.error(`[content-factory-planning] job ${job.id} failed:`, err.message));
contentFactoryPlanningQueue.on("stalled", (job) => console.warn(`[content-factory-planning] job ${job.id} stalled, will be reclaimed`));
contentFactoryPlanningQueue.on("error", (err) => console.error("[content-factory-planning] connection error:", err.message));

// Bull dedupes repeatables by cron+data, so calling this on every boot is safe.
export async function scheduleContentFactoryRepeatables() {
  await contentFactoryPlanningQueue.add({}, { repeat: { cron: "0 5 * * *" }, ...SYNC_RETRY_CONFIG });
}

// Manual trigger — POST /admin/content-factory/plan/run-now enqueues this
// immediately rather than waiting for the daily cron. Still runs the exact
// same runDailyPlanningJob sequence (PAUSED check, budget guard, etc.), just
// triggeredBy MANUAL instead of CRON.
export function enqueuePlanningRunNow() {
  return contentFactoryPlanningQueue.add({ triggeredBy: "MANUAL" }, { attempts: 1 });
}
