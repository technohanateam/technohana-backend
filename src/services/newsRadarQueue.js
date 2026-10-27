import Bull from "bull";
import { redisConfig } from "../config/redis.js";
import { SYNC_RETRY_CONFIG } from "./seoIntelQueue.js";
import { runNewsRadar } from "./newsRadar.service.js";

// Same settings/retry preset as contentFactoryQueue.js.
const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 5 * 60 * 1000 } };

export const newsRadarQueue = new Bull("news-radar", { redis: redisConfig, ...QUEUE_SETTINGS });

newsRadarQueue.process(async (job) => runNewsRadar({ triggeredBy: job.data?.triggeredBy || "CRON" }));

newsRadarQueue.on("failed", (job, err) => console.error(`[news-radar] job ${job.id} failed:`, err.message));
newsRadarQueue.on("stalled", (job) => console.warn(`[news-radar] job ${job.id} stalled, will be reclaimed`));
newsRadarQueue.on("error", (err) => console.error("[news-radar] connection error:", err.message));

// Hourly, on the hour. Bull dedupes repeatables by cron+data, so calling this on every boot is safe.
export async function scheduleNewsRadarRepeatable() {
  await newsRadarQueue.add({}, { repeat: { cron: "0 * * * *" }, ...SYNC_RETRY_CONFIG });
}

export function enqueueNewsRadarRunNow() {
  return newsRadarQueue.add({ triggeredBy: "MANUAL" }, { attempts: 1 });
}
