import Bull from "bull";
import { redisConfig } from "../config/redis.js";
import { syncAllMailboxes } from "./zohoMailSync.js";

const QUEUE_SETTINGS = { settings: { maxStalledCount: 1, lockDuration: 5 * 60 * 1000 } };

export const zohoMailSyncQueue = new Bull("zoho-mail-sync", { redis: redisConfig, ...QUEUE_SETTINGS });

zohoMailSyncQueue.process(async () => syncAllMailboxes());

zohoMailSyncQueue.on("completed", (job, r) => {
  if (r?.imported || r?.failed) console.log(`[zoho-mail-sync] ${r.mailboxes} mailbox(es), ${r.imported} imported, ${r.failed} failed`);
});
zohoMailSyncQueue.on("failed", (job, err) => console.error(`[zoho-mail-sync] job ${job.id} failed:`, err.message));
zohoMailSyncQueue.on("error", (err) => console.error("[zoho-mail-sync] connection error:", err.message));

// Bull dedupes repeatables by cron+data, so calling this on every boot is safe.
const SYNC_CRON = "* * * * *";

export async function scheduleZohoMailSyncRepeatable() {
  // A cron change leaves the old schedule in Redis, so drop any other one first.
  for (const job of await zohoMailSyncQueue.getRepeatableJobs()) {
    if (job.cron !== SYNC_CRON) await zohoMailSyncQueue.removeRepeatableByKey(job.key);
  }
  await zohoMailSyncQueue.add({}, { repeat: { cron: SYNC_CRON }, attempts: 1, removeOnComplete: true, removeOnFail: 20 });
}
