import Bull from "bull";
import { redisConfig } from "../../config/redis.js";
import { runCampaignOpportunityScan } from "./campaignOpportunityJob.js";

// Mirrors contentFactory/contentFactoryQueue.js's settings/pattern.
const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 5 * 60 * 1000 } };

export const campaignOpportunityQueue = new Bull("campaign-opportunity-planning", { redis: redisConfig, ...QUEUE_SETTINGS });

campaignOpportunityQueue.process(async (job) => {
  return runCampaignOpportunityScan({ triggeredBy: job.data?.triggeredBy || "CRON" });
});

campaignOpportunityQueue.on("completed", (job) => console.log(`[campaign-opportunity-planning] job ${job.id} completed`));
campaignOpportunityQueue.on("failed", (job, err) => console.error(`[campaign-opportunity-planning] job ${job.id} failed:`, err.message));
campaignOpportunityQueue.on("stalled", (job) => console.warn(`[campaign-opportunity-planning] job ${job.id} stalled, will be reclaimed`));
campaignOpportunityQueue.on("error", (err) => console.error("[campaign-opportunity-planning] connection error:", err.message));

// Bull dedupes repeatables by cron+data, so calling this on every boot is safe.
export async function scheduleCampaignOpportunityRepeatable() {
  // Daily, 6am — after the content factory's daily planning (5am) so the two
  // AI-spend jobs don't contend for the same minute.
  await campaignOpportunityQueue.add({}, { repeat: { cron: "0 6 * * *" }, attempts: 1 });
}

// Manual trigger — POST /admin/campaigns/opportunities/run-now.
export function enqueueOpportunityScanNow() {
  return campaignOpportunityQueue.add({ triggeredBy: "MANUAL" }, { attempts: 1 });
}
