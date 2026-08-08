import Bull from "bull";
import { redisConfig } from "../../config/redis.js";
import { SYNC_RETRY_CONFIG } from "../seoIntelQueue.js";
import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";
import ContentRun from "../../models/contentRun.model.js";
import { generateOpportunityCandidates } from "./contentStrategy.service.js";

// Mirrors the backlinkQueue.js/seoIntelQueue.js pattern — same settings,
// imported retry preset (not redefined).
const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 5 * 60 * 1000 } };

export const contentFactoryPlanningQueue = new Bull("content-factory-planning", { redis: redisConfig, ...QUEUE_SETTINGS });

contentFactoryPlanningQueue.process(async () => {
  const settings = await getOrCreateContentFactorySettings();

  if (settings.automationStatus === "PAUSED") {
    await ContentRun.create({
      runType: "PLANNING",
      triggeredBy: "CRON",
      status: "COMPLETE",
      startedAt: new Date(),
      finishedAt: new Date(),
      coursesEvaluated: 0,
      opportunitiesCreated: 0,
      opportunitiesSkippedDuplicate: 0,
      articlesGenerated: 0,
      errors: ["skipped — automation paused"],
      dryRun: false,
      settingsSnapshot: settings.toObject ? settings.toObject() : settings,
    });
    return { skipped: true, reason: "automation paused" };
  }

  return generateOpportunityCandidates({ dryRun: false, triggeredBy: "CRON" });
});

contentFactoryPlanningQueue.on("completed", (job) => console.log(`[content-factory-planning] job ${job.id} completed`));
contentFactoryPlanningQueue.on("failed", (job, err) => console.error(`[content-factory-planning] job ${job.id} failed:`, err.message));
contentFactoryPlanningQueue.on("stalled", (job) => console.warn(`[content-factory-planning] job ${job.id} stalled, will be reclaimed`));
contentFactoryPlanningQueue.on("error", (err) => console.error("[content-factory-planning] connection error:", err.message));

// Bull dedupes repeatables by cron+data, so calling this on every boot is safe.
export async function scheduleContentFactoryRepeatables() {
  await contentFactoryPlanningQueue.add({}, { repeat: { cron: "0 5 * * *" }, ...SYNC_RETRY_CONFIG });
}
