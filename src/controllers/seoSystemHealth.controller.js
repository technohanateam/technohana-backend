import SeoConnection from "../models/seoConnection.model.js";
import SeoCrawlRun from "../models/seoCrawlRun.model.js";
import SeoRecommendation from "../models/seoRecommendation.model.js";
import SeoIntelligenceSettings from "../models/seoIntelligenceSettings.model.js";
import { gscSyncQueue, ga4SyncQueue, crawlQueue, execReportQueue, scoreRecalcQueue } from "../services/seoIntelQueue.js";

const QUEUES = { gscSyncQueue, ga4SyncQueue, crawlQueue, execReportQueue, scoreRecalcQueue };

function connectionStatus(connections) {
  if (connections.length === 0) return { status: "error", message: "No property connected" };
  const failing = connections.filter((c) => c.lastSyncStatus === "error");
  if (failing.length) return { status: "warning", message: `${failing.length} connection(s) with failed last sync`, lastSyncError: failing[0].lastSyncError };
  const neverSynced = connections.filter((c) => c.lastSyncStatus === "never");
  if (neverSynced.length === connections.length) return { status: "warning", message: "Connected but never synced" };
  return { status: "ok", message: "Connected and syncing" };
}

async function checkRedis() {
  try {
    // Every SEO queue shares the same Redis connection config, so pinging
    // one Bull-managed client is representative of the shared connection.
    const pong = await gscSyncQueue.client.ping();
    return { status: pong === "PONG" ? "ok" : "warning", message: pong === "PONG" ? "Connected" : `Unexpected response: ${pong}` };
  } catch (err) {
    return { status: "error", message: err.message };
  }
}

async function checkQueues() {
  const results = {};
  let anyDown = false;
  for (const [name, queue] of Object.entries(QUEUES)) {
    const ready = queue.client?.status === "ready";
    if (!ready) anyDown = true;
    results[name] = ready ? "ready" : queue.client?.status || "unknown";
  }
  return { status: anyDown ? "error" : "ok", message: anyDown ? "One or more queues not connected" : "All queues connected", queues: results };
}

export const getSystemHealth = async (req, res) => {
  try {
    const [connections, latestCrawl, latestRecommendation, settings, redis, queues] = await Promise.all([
      SeoConnection.find().lean(),
      SeoCrawlRun.findOne().sort({ startedAt: -1 }).lean(),
      SeoRecommendation.findOne().sort({ generatedAt: -1 }).lean(),
      SeoIntelligenceSettings.findOne().lean(),
      checkRedis(),
      checkQueues(),
    ]);

    const gscConnections = connections.filter((c) => c.provider === "gsc" && c.isActive);
    const ga4Connections = connections.filter((c) => c.provider === "ga4" && c.isActive && !c.pendingSelection);

    const lastSyncedAt = connections.reduce((latest, c) => {
      if (!c.lastSyncedAt) return latest;
      return !latest || c.lastSyncedAt > latest ? c.lastSyncedAt : latest;
    }, null);

    const emailConfigured = Boolean(process.env.RESEND_API_KEY);

    const checks = {
      searchConsole: connectionStatus(gscConnections),
      ga4: connectionStatus(ga4Connections),
      redis: redis,
      queues: queues,
      crawl: latestCrawl
        ? { status: latestCrawl.status === "completed" ? "ok" : latestCrawl.status === "failed" ? "error" : "warning", message: `Last crawl: ${latestCrawl.status}`, lastCrawlAt: latestCrawl.finishedAt || latestCrawl.startedAt }
        : { status: "warning", message: "No crawl has run yet" },
      email: { status: emailConfigured ? "ok" : "error", message: emailConfigured ? "Resend API key configured" : "RESEND_API_KEY not set" },
    };

    const overall = Object.values(checks).some((c) => c.status === "error")
      ? "error"
      : Object.values(checks).some((c) => c.status === "warning")
        ? "warning"
        : "ok";

    return res.json({
      success: true,
      data: {
        overall,
        checks,
        lastSyncedAt,
        lastCrawlAt: latestCrawl?.finishedAt || latestCrawl?.startedAt || null,
        lastReportAt: settings?.lastExecReportSentAt || null,
        lastRecommendationRunAt: latestRecommendation?.generatedAt || null,
      },
    });
  } catch (error) {
    console.error("Error computing SEO system health:", error);
    return res.status(500).json({ success: false, message: "Error computing system health" });
  }
};
