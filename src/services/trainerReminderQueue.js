import Bull from "bull";
import { redisConfig } from "../config/redis.js";
import { sendAttendanceReminders, sendGigClosingReminders } from "./trainerNotifications.js";

const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 5 * 60 * 1000 } };

export const trainerReminderQueue = new Bull("trainer-attendance-reminder", { redis: redisConfig, ...QUEUE_SETTINGS });

trainerReminderQueue.process(async (job) => (job.data?.type === "gig-closing" ? sendGigClosingReminders() : sendAttendanceReminders()));

trainerReminderQueue.on("completed", (job, result) => console.log(`[trainer-reminder] job ${job.id} emailed ${result?.sent ?? 0} trainer(s)`));
trainerReminderQueue.on("failed", (job, err) => console.error(`[trainer-reminder] job ${job.id} failed:`, err.message));
trainerReminderQueue.on("error", (err) => console.error("[trainer-reminder] connection error:", err.message));

// Bull dedupes repeatables by cron+data, so calling this on every boot is safe.
export async function scheduleTrainerReminderRepeatable() {
  // 10am IST — after morning classes have started, so yesterday's evening sessions are covered.
  await trainerReminderQueue.add({}, { repeat: { cron: "0 10 * * *", tz: "Asia/Kolkata" }, attempts: 1 });
  // 9am IST: open gigs closing within 48h, emailed to trainers who have not applied.
  await trainerReminderQueue.add({ type: "gig-closing" }, { repeat: { cron: "0 9 * * *", tz: "Asia/Kolkata" }, attempts: 1 });
}
