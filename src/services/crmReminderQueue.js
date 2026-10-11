import Bull from "bull";
import { redisConfig } from "../config/redis.js";
import { sendDueTaskReminders, sendDailyDigests } from "./crmReminders.js";

const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 5 * 60 * 1000 } };

export const crmReminderQueue = new Bull("crm-reminders", { redis: redisConfig, ...QUEUE_SETTINGS });

crmReminderQueue.process("due-reminders", async () => sendDueTaskReminders());
crmReminderQueue.process("daily-digest", async () => sendDailyDigests());

crmReminderQueue.on("completed", (job, result) => {
  if (result?.sent) console.log(`[crm-reminders] ${job.name} sent ${result.sent}`);
});
crmReminderQueue.on("failed", (job, err) => console.error(`[crm-reminders] ${job.name} failed:`, err.message));
crmReminderQueue.on("error", (err) => console.error("[crm-reminders] connection error:", err.message));

// Bull dedupes repeatables by name+repeat options, so calling this on every boot is safe.
export async function scheduleCrmReminders() {
  await crmReminderQueue.add("due-reminders", {}, { repeat: { every: 15 * 60 * 1000 }, attempts: 1, removeOnComplete: true });
  await crmReminderQueue.add("daily-digest", {}, { repeat: { cron: "0 9 * * *", tz: "Asia/Kolkata" }, attempts: 1, removeOnComplete: true });
}
