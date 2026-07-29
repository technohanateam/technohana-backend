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

const redisConfig = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
};
if (process.env.REDIS_PASSWORD) redisConfig.password = process.env.REDIS_PASSWORD;

export const gscSyncQueue = new Bull("seo-gsc-sync", { redis: redisConfig });
export const ga4SyncQueue = new Bull("seo-ga4-sync", { redis: redisConfig });
export const crawlQueue = new Bull("seo-crawl", { redis: redisConfig });
export const execReportQueue = new Bull("seo-exec-report", { redis: redisConfig });
export const scoreRecalcQueue = new Bull("seo-score-recalc", { redis: redisConfig });

async function getSettings() {
  let settings = await SeoIntelligenceSettings.findOne();
  if (!settings) settings = await SeoIntelligenceSettings.create({});
  return settings;
}

gscSyncQueue.process(async () => {
  const connections = await SeoConnection.find({ provider: "gsc", isActive: true });
  for (const connection of connections) {
    try {
      const client = await getAuthedClientForConnection(connection);
      await syncGscProperty({ propertyId: connection.propertyId, authedClient: client });
      await generateRecommendationsFromGsc(connection.propertyId);
      await checkGscAlerts(connection.propertyId);
      connection.lastSyncedAt = new Date();
      connection.lastSyncStatus = "success";
      connection.lastSyncError = undefined;
      await connection.save();
    } catch (err) {
      console.error(`[GSC Sync] failed for ${connection.propertyId}:`, err.message);
      connection.lastSyncStatus = "error";
      connection.lastSyncError = err.message;
      await connection.save();
    }
  }
});

ga4SyncQueue.process(async () => {
  const connections = await SeoConnection.find({ provider: "ga4", isActive: true });
  for (const connection of connections) {
    try {
      const client = await getAuthedClientForConnection(connection);
      await syncGa4Property({ propertyId: connection.propertyId, authedClient: client });
      await generateRecommendationsFromGa4(connection.propertyId);
      await checkGa4Alerts(connection.propertyId);
      connection.lastSyncedAt = new Date();
      connection.lastSyncStatus = "success";
      connection.lastSyncError = undefined;
      await connection.save();
    } catch (err) {
      console.error(`[GA4 Sync] failed for ${connection.propertyId}:`, err.message);
      connection.lastSyncStatus = "error";
      connection.lastSyncError = err.message;
      await connection.save();
    }
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
});

scoreRecalcQueue.process(async () => {
  // Health score is computed on-demand in the executive dashboard endpoint
  // from the latest crawl/GSC/GA4 data; this job is a no-op placeholder
  // reserved for future rolling-average recalculation.
  return { recalculated: true };
});

for (const [name, queue] of Object.entries({ gscSyncQueue, ga4SyncQueue, crawlQueue, execReportQueue, scoreRecalcQueue })) {
  queue.on("failed", (job, err) => console.error(`[${name}] job ${job.id} failed:`, err.message));
}

// Bull dedupes repeatables by cron+data automatically, so calling this on
// every boot is safe and keeps the schedule declared in one place.
export async function scheduleSeoIntelRepeatables() {
  await gscSyncQueue.add({}, { repeat: { cron: "0 3 * * *" } });
  await ga4SyncQueue.add({}, { repeat: { cron: "0 3 * * *" } });
  await crawlQueue.add({ triggeredBy: "cron" }, { repeat: { cron: "0 4 * * 1" } });
  await execReportQueue.add({}, { repeat: { cron: "0 8 * * 1" } });
  await scoreRecalcQueue.add({}, { repeat: { cron: "0 5 1 * *" } });
}
