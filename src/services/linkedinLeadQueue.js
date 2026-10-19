import Bull from "bull";
import { redisConfig } from "../config/redis.js";
import { syncLinkedInLeads } from "./linkedinLeadAds.js";

const QUEUE_SETTINGS = { settings: { maxStalledCount: 1, lockDuration: 5 * 60 * 1000 } };

export const linkedinLeadQueue = new Bull("linkedin-leads", { redis: redisConfig, ...QUEUE_SETTINGS });

linkedinLeadQueue.process(async () => syncLinkedInLeads());

linkedinLeadQueue.on("completed", (job, r) => {
  if (r?.imported || r?.failed) console.log(`[linkedin-leads] ${r.imported} imported, ${r.failed} failed`);
});
linkedinLeadQueue.on("failed", (job, err) => console.error(`[linkedin-leads] job ${job.id} failed:`, err.message));
linkedinLeadQueue.on("error", (err) => console.error("[linkedin-leads] connection error:", err.message));

// Bull dedupes repeatables by cron+data, so calling this on every boot is safe.
export async function scheduleLinkedInLeadSyncRepeatable() {
  await linkedinLeadQueue.add({}, { repeat: { cron: "*/10 * * * *" }, attempts: 1, removeOnComplete: true, removeOnFail: 20 });
}
