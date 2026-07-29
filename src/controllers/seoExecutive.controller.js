import SeoConnection from "../models/seoConnection.model.js";
import SeoGscMetric from "../models/seoGscMetric.model.js";
import SeoGa4Metric from "../models/seoGa4Metric.model.js";
import SeoCrawlRun from "../models/seoCrawlRun.model.js";
import SeoRecommendation from "../models/seoRecommendation.model.js";
import SeoAlert from "../models/seoAlert.model.js";

function sumMetric(rows, field) {
  return rows.reduce((sum, r) => sum + (r[field] || 0), 0);
}

async function gscTrend() {
  const activeConnections = await SeoConnection.find({ provider: "gsc", isActive: true }).lean();
  if (activeConnections.length === 0) return { available: false };

  const syncedConnection = activeConnections.find((c) => c.lastSyncStatus === "success");
  if (!syncedConnection) {
    // Connected but never successfully synced — distinct from "no connection
    // at all" and from "confirmed zero traffic," both of which also present
    // as available:false/zero downstream without this.
    const failing = activeConnections.find((c) => c.lastSyncStatus === "error");
    return { available: false, lastSyncStatus: failing ? "error" : "never", lastSyncError: failing?.lastSyncError };
  }

  const propertyIds = activeConnections.map((c) => c.propertyId);
  const now = new Date();
  const recentStart = new Date(now - 28 * 86400000);
  const priorStart = new Date(now - 56 * 86400000);

  const recent = await SeoGscMetric.find({ propertyId: { $in: propertyIds }, dimensionType: "date", date: { $gte: recentStart } }).lean();
  const prior = await SeoGscMetric.find({ propertyId: { $in: propertyIds }, dimensionType: "date", date: { $gte: priorStart, $lt: recentStart } }).lean();

  const recentClicks = sumMetric(recent, "clicks");
  const priorClicks = sumMetric(prior, "clicks");
  const recentImpressions = sumMetric(recent, "impressions");

  return {
    available: true,
    lastSyncStatus: "success",
    clicks: recentClicks,
    impressions: recentImpressions,
    changePercent: priorClicks > 0 ? ((recentClicks - priorClicks) / priorClicks) * 100 : null,
  };
}

async function ga4Trend() {
  const activeConnections = await SeoConnection.find({ provider: "ga4", isActive: true }).lean();
  if (activeConnections.length === 0) return { available: false };

  const syncedConnection = activeConnections.find((c) => c.lastSyncStatus === "success");
  if (!syncedConnection) {
    const failing = activeConnections.find((c) => c.lastSyncStatus === "error");
    return { available: false, lastSyncStatus: failing ? "error" : "never", lastSyncError: failing?.lastSyncError };
  }

  const propertyIds = activeConnections.map((c) => c.propertyId);
  const now = new Date();
  const recentStart = new Date(now - 28 * 86400000);
  const priorStart = new Date(now - 56 * 86400000);

  const recent = await SeoGa4Metric.find({ propertyId: { $in: propertyIds }, dimensionType: "landingPage", date: { $gte: recentStart } }).lean();
  const prior = await SeoGa4Metric.find({ propertyId: { $in: propertyIds }, dimensionType: "landingPage", date: { $gte: priorStart, $lt: recentStart } }).lean();

  const recentSessions = sumMetric(recent, "sessions");
  const priorSessions = sumMetric(prior, "sessions");
  const conversions = sumMetric(recent, "conversions");

  return {
    available: true,
    lastSyncStatus: "success",
    sessions: recentSessions,
    conversions,
    changePercent: priorSessions > 0 ? ((recentSessions - priorSessions) / priorSessions) * 100 : null,
  };
}

function computeHealthScore(summary) {
  if (!summary) return null;
  const critical = (summary.brokenLinks || 0) + (summary.noindexPages || 0) + (summary.brokenImages || 0);
  const warnings =
    (summary.missingTitle || 0) +
    (summary.missingMetaDescription || 0) +
    (summary.missingH1 || 0) +
    (summary.multipleH1 || 0) +
    (summary.missingCanonical || 0) +
    (summary.thinPages || 0) +
    (summary.slowPages || 0) +
    (summary.missingAlt || 0) +
    (summary.largeImages || 0);
  return Math.max(0, Math.min(100, 100 - critical * 5 - warnings * 1));
}

export const getExecutiveDashboard = async (req, res) => {
  try {
    const [traffic, seo, latestCrawl, recommendationCounts, alerts] = await Promise.all([
      ga4Trend(),
      gscTrend(),
      SeoCrawlRun.findOne({ status: "completed" }).sort({ startedAt: -1 }).lean(),
      SeoRecommendation.aggregate([{ $match: { status: "open" } }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
      SeoAlert.find({ acknowledged: false }).sort({ triggeredAt: -1 }).limit(20).lean(),
    ]);

    const health = latestCrawl
      ? { available: true, score: computeHealthScore(latestCrawl.summary), summary: latestCrawl.summary, crawledAt: latestCrawl.finishedAt }
      : { available: false };

    const recommendations = { available: true, byPriority: {} };
    for (const row of recommendationCounts) recommendations.byPriority[row._id] = row.count;

    return res.json({
      success: true,
      data: { seo, traffic, health, recommendations, alerts },
    });
  } catch (error) {
    console.error("Error building executive dashboard:", error);
    return res.status(500).json({ success: false, message: "Error building executive dashboard" });
  }
};

export const getHealthScore = async (req, res) => {
  try {
    const latestCrawl = await SeoCrawlRun.findOne({ status: "completed" }).sort({ startedAt: -1 }).lean();
    if (!latestCrawl) return res.json({ success: true, data: { available: false } });
    return res.json({ success: true, data: { available: true, score: computeHealthScore(latestCrawl.summary), summary: latestCrawl.summary } });
  } catch (error) {
    console.error("Error computing health score:", error);
    return res.status(500).json({ success: false, message: "Error computing health score" });
  }
};

export { computeHealthScore };
