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
// Off unless LINKEDIN_LEAD_SYNC_ENABLED=true (set it once the Lead Sync API product is approved);
// repeatables persist in Redis, so when off we also remove any left over from earlier boots.
export async function scheduleLinkedInLeadSyncRepeatable() {
  if (process.env.LINKEDIN_LEAD_SYNC_ENABLED !== "true") {
    const existing = await linkedinLeadQueue.getRepeatableJobs();
    await Promise.all(existing.map((job) => linkedinLeadQueue.removeRepeatableByKey(job.key)));
    return;
  }
  await linkedinLeadQueue.add({}, { repeat: { cron: "*/10 * * * *" }, attempts: 1, removeOnComplete: true, removeOnFail: 20 });
}
