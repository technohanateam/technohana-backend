import Bull from "bull";
import { redisConfig } from "../config/redis.js";
import { runInstalmentChecks } from "./instalments.js";

const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 5 * 60 * 1000 } };

export const instalmentQueue = new Bull("instalment-checks", { redis: redisConfig, ...QUEUE_SETTINGS });

instalmentQueue.process("daily-checks", async () => runInstalmentChecks());

instalmentQueue.on("completed", (job, result) => {
  if (result?.reminded || result?.due || result?.held) console.log(`[instalments] ${job.name}`, result);
});
instalmentQueue.on("failed", (job, err) => console.error(`[instalments] ${job.name} failed:`, err.message));
instalmentQueue.on("error", (err) => console.error("[instalments] connection error:", err.message));

// Bull dedupes repeatables by name+repeat options, so calling this on every boot is safe.
export async function scheduleInstalmentChecks() {
  await instalmentQueue.add("daily-checks", {}, { repeat: { cron: "0 9 * * *", tz: "Asia/Kolkata" }, attempts: 1, removeOnComplete: true });
}
