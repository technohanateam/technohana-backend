import Bull from "bull";
import { redisConfig } from "../config/redis.js";
import { checkInstagramToken } from "./instagramToken.js";

export const instagramTokenQueue = new Bull("instagram-token", { redis: redisConfig, settings: { maxStalledCount: 2 } });

instagramTokenQueue.process(async () => checkInstagramToken());

instagramTokenQueue.on("failed", (job, err) => console.error(`[instagram-token] job ${job.id} failed:`, err.message));
instagramTokenQueue.on("error", (err) => console.error("[instagram-token] connection error:", err.message));

// Bull dedupes repeatables by cron+data, so calling this on every boot is safe.
export async function scheduleInstagramTokenRepeatable() {
  await instagramTokenQueue.add({}, { repeat: { cron: "0 10 * * *", tz: "Asia/Kolkata" }, attempts: 1 });
  // Also check shortly after each boot so a fresh deploy doesn't wait until 10am.
  await instagramTokenQueue.add({}, { delay: 2 * 60 * 1000, attempts: 1, removeOnComplete: true });
}
