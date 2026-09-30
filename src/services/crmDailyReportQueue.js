import Bull from "bull";
import { redisConfig } from "../config/redis.js";
import { sendDailyReportEmail } from "./crmDailyReport.js";

const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 5 * 60 * 1000 } };

export const crmDailyReportQueue = new Bull("crm-daily-report", { redis: redisConfig, ...QUEUE_SETTINGS });

crmDailyReportQueue.process(async () => sendDailyReportEmail());

crmDailyReportQueue.on("completed", (job, result) => console.log(`[crm-daily-report] job ${job.id} sent to ${result?.sent ?? 0} recipient(s)`));
crmDailyReportQueue.on("failed", (job, err) => console.error(`[crm-daily-report] job ${job.id} failed:`, err.message));
crmDailyReportQueue.on("error", (err) => console.error("[crm-daily-report] connection error:", err.message));

// Bull dedupes repeatables by cron+data, so calling this on every boot is safe.
export async function scheduleCrmDailyReportRepeatable() {
  // 7pm IST every day — covers the full working day just ended.
  await crmDailyReportQueue.add({}, { repeat: { cron: "0 19 * * *", tz: "Asia/Kolkata" }, attempts: 1 });
}
