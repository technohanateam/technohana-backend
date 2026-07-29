import Bull from "bull";
import SeoConnection from "../models/seoConnection.model.js";
import SeoIntelligenceSettings from "../models/seoIntelligenceSettings.model.js";
import SeoCrawlRun from "../models/seoCrawlRun.model.js";
import { getAuthedClientForConnection } from "../config/googleSeoOAuth.js";
import { syncGscProperty } from "./gscSyncService.js";
import { syncGa4Property } from "./ga4SyncService.js";
import { runCrawl } from "./seoCrawler.js";
import { generateRecommendationsFromCrawl, generateRecommendationsFromGsc, generateRecommendationsFromGa4 } from "./recommendationEngine.js";
import { checkGscAlerts, checkGa4Alerts, checkCrawlAlerts } from "./seoAlertService.js";
import { sendEmail } from "../config/emailService.js";
import { redisConfig } from "../config/redis.js";

// Shared settings so stalled jobs (worker died mid-job) get reclaimed and
// retried instead of sitting locked forever, and completed/failed jobs get
// trimmed instead of accumulating in Redis indefinitely.
const QUEUE_SETTINGS = { settings: { maxStalledCount: 2, lockDuration: 5 * 60 * 1000 } };
export const JOB_CLEANUP = { removeOnComplete: 50, removeOnFail: 200 };

export const gscSyncQueue = new Bull("seo-gsc-sync", { redis: redisConfig, ...QUEUE_SETTINGS });
export const ga4SyncQueue = new Bull("seo-ga4-sync", { redis: redisConfig, ...QUEUE_SETTINGS });
export const crawlQueue = new Bull("seo-crawl", { redis: redisConfig, ...QUEUE_SETTINGS });
export const execReportQueue = new Bull("seo-exec-report", { redis: redisConfig, ...QUEUE_SETTINGS });
export const scoreRecalcQueue = new Bull("seo-score-recalc", { redis: redisConfig, ...QUEUE_SETTINGS });

async function getSettings() {
  let settings = await SeoIntelligenceSettings.findOne();
  if (!settings) settings = await SeoIntelligenceSettings.create({});
  return settings;
}

gscSyncQueue.process(async () => {
  const connections = await SeoConnection.find({ provider: "gsc", isActive: true });
  const failedPropertyIds = [];

  for (const connection of connections) {
    try {
      const client = await getAuthedClientForConnection(connection);
      await syncGscProperty({ propertyId: connection.propertyId, authedClient: client });
      // Record success as soon as the actual sync commits — recommendation
      // generation and alerting below are unrelated post-processing and
      // must not be able to overwrite a genuinely successful sync's status.
      connection.lastSyncedAt = new Date();
      connection.lastSyncStatus = "success";
      connection.lastSyncError = undefined;
      await connection.save();
    } catch (err) {
      console.error(`[GSC Sync] failed for ${connection.propertyId}:`, err.message);
      connection.lastSyncStatus = "error";
      connection.lastSyncError = err.message;
      await connection.save();
      failedPropertyIds.push(connection.propertyId);
      continue;
    }

    try {
      await generateRecommendationsFromGsc(connection.propertyId);
      await checkGscAlerts(connection.propertyId);
    } catch (err) {
      console.error(`[GSC Sync] post-processing failed for ${connection.propertyId} (sync itself succeeded):`, err.message);
    }
  }

  // Loop continues past individual failures so one bad connection doesn't
  // block the rest, but the job still needs to surface as failed to Bull
  // (for retry/backoff and the "failed" event) when anything went wrong.
  if (failedPropertyIds.length) {
    throw new Error(`GSC sync failed for: ${failedPropertyIds.join(", ")}`);
  }
});

ga4SyncQueue.process(async () => {
  const connections = await SeoConnection.find({ provider: "ga4", isActive: true });
  const failedPropertyIds = [];

  for (const connection of connections) {
    try {
      const client = await getAuthedClientForConnection(connection);
      await syncGa4Property({ propertyId: connection.propertyId, authedClient: client });
      connection.lastSyncedAt = new Date();
      connection.lastSyncStatus = "success";
      connection.lastSyncError = undefined;
      await connection.save();
    } catch (err) {
      console.error(`[GA4 Sync] failed for ${connection.propertyId}:`, err.message);
      connection.lastSyncStatus = "error";
      connection.lastSyncError = err.message;
      await connection.save();
      failedPropertyIds.push(connection.propertyId);
      continue;
    }

    try {
      await generateRecommendationsFromGa4(connection.propertyId);
      await checkGa4Alerts(connection.propertyId);
    } catch (err) {
      console.error(`[GA4 Sync] post-processing failed for ${connection.propertyId} (sync itself succeeded):`, err.message);
    }
  }

  if (failedPropertyIds.length) {
    throw new Error(`GA4 sync failed for: ${failedPropertyIds.join(", ")}`);
  }
});

crawlQueue.process(async (job) => {
  const settings = await getSettings();
  const baseUrl = settings.crawlBaseUrl;
  if (!baseUrl) {
    console.warn("[SEO Crawl] no crawlBaseUrl configured, skipping");
    return;
  }
  const previousRun = await SeoCrawlRun.findOne({ status: "completed" }).sort({ startedAt: -1 });
  const run = await runCrawl({
    baseUrl,
    maxPages: settings.crawlMaxPages,
    concurrency: settings.crawlConcurrency,
    triggeredBy: job.data?.triggeredBy || "cron",
  });
  await generateRecommendationsFromCrawl(run._id);
  await checkCrawlAlerts(previousRun, run);
  return { crawlRunId: run._id.toString() };
});

execReportQueue.process(async () => {
  const settings = await getSettings();
  if (!settings.alertEmailRecipients?.length) return;
  const latestCrawl = await SeoCrawlRun.findOne({ status: "completed" }).sort({ startedAt: -1 }).lean();
  await sendEmail({
    from: "SEO Reports <corporate@technohana.in>",
    to: settings.alertEmailRecipients,
    subject: "Weekly SEO Executive Report",
    html: `<p>Latest crawl: ${latestCrawl ? `${latestCrawl.pagesCrawled} pages crawled, ${latestCrawl.pagesErrored} errors.` : "No crawl data yet."}</p>`,
  });
  settings.lastExecReportSentAt = new Date();
  await settings.save();
});

scoreRecalcQueue.process(async () => {
  // Health score is computed on-demand in the executive dashboard endpoint
  // from the latest crawl/GSC/GA4 data; this job is a no-op placeholder
  // reserved for future rolling-average recalculation.
  return { recalculated: true };
});

for (const [name, queue] of Object.entries({ gscSyncQueue, ga4SyncQueue, crawlQueue, execReportQueue, scoreRecalcQueue })) {
  queue.on("completed", (job) => console.log(`[${name}] job ${job.id} completed`));
  queue.on("failed", (job, err) => console.error(`[${name}] job ${job.id} failed:`, err.message));
  queue.on("stalled", (job) => console.warn(`[${name}] job ${job.id} stalled, will be reclaimed`));
  queue.on("error", (err) => console.error(`[${name}] connection error:`, err.message));
}

// Bull dedupes repeatables by cron+data automatically, so calling this on
// every boot is safe and keeps the schedule declared in one place.
export const SYNC_RETRY_CONFIG = { attempts: 3, backoff: { type: "exponential", delay: 60000 }, ...JOB_CLEANUP };
// Crawl/report/recalc jobs are single heavyweight runs (not per-connection
// loops), so a retry just re-does the whole thing — still worth one retry
// in case of a transient DB/network blip, but with a longer backoff.
export const SINGLE_RUN_RETRY_CONFIG = { attempts: 2, backoff: { type: "exponential", delay: 5 * 60000 }, ...JOB_CLEANUP };

export async function scheduleSeoIntelRepeatables() {
  await gscSyncQueue.add({}, { repeat: { cron: "0 3 * * *" }, ...SYNC_RETRY_CONFIG });
  await ga4SyncQueue.add({}, { repeat: { cron: "0 3 * * *" }, ...SYNC_RETRY_CONFIG });
  await crawlQueue.add({ triggeredBy: "cron" }, { repeat: { cron: "0 4 * * 1" }, ...SINGLE_RUN_RETRY_CONFIG });
  await execReportQueue.add({}, { repeat: { cron: "0 8 * * 1" }, ...SINGLE_RUN_RETRY_CONFIG });
  await scoreRecalcQueue.add({}, { repeat: { cron: "0 5 1 * *" }, ...SINGLE_RUN_RETRY_CONFIG });
}
