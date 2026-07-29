import SeoConnection from "../models/seoConnection.model.js";
import SeoGscMetric from "../models/seoGscMetric.model.js";
import SeoGscSitemap from "../models/seoGscSitemap.model.js";
import { getAuthedClientForConnection } from "../config/googleSeoOAuth.js";
import { syncGscProperty, inspectUrl } from "../services/gscSyncService.js";
import { gscSyncQueue, SYNC_RETRY_CONFIG } from "../services/seoIntelQueue.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";
import { dateRange, isValidPropertyId } from "../utils/seoDateRange.js";

export const getGscSummary = async (req, res) => {
  try {
    const { propertyId } = req.query;
    if (!isValidPropertyId(propertyId)) return res.status(400).json({ success: false, message: "propertyId is required" });
    const { from, to } = dateRange(req);

    const rows = await SeoGscMetric.find({ propertyId, dimensionType: "date", date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean();
    const totals = rows.reduce(
      (acc, r) => ({
        clicks: acc.clicks + r.clicks,
        impressions: acc.impressions + r.impressions,
      }),
      { clicks: 0, impressions: 0 }
    );
    const avgCtr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
    // Weighted by impressions, consistent with avgCtr above — an unweighted
    // per-row average lets a near-zero-impression day skew position as much
    // as a high-impression one.
    const avgPosition = totals.impressions > 0 ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / totals.impressions : 0;

    return res.json({ success: true, data: { totals: { ...totals, ctr: avgCtr, position: avgPosition }, trend: rows } });
  } catch (error) {
    console.error("Error fetching GSC summary:", error);
    return res.status(500).json({ success: false, message: "Error fetching GSC summary" });
  }
};

const dimensionEndpoint = (dimensionType) => async (req, res) => {
  try {
    const { propertyId } = req.query;
    if (!isValidPropertyId(propertyId)) return res.status(400).json({ success: false, message: "propertyId is required" });
    const { from, to } = dateRange(req);
    const rows = await SeoGscMetric.find({ propertyId, dimensionType, date: { $gte: from, $lte: to } })
      .sort({ clicks: -1 })
      .limit(200)
      .lean();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error(`Error fetching GSC ${dimensionType}:`, error);
    return res.status(500).json({ success: false, message: `Error fetching GSC ${dimensionType}` });
  }
};

export const getGscQueries = dimensionEndpoint("query");
export const getGscPages = dimensionEndpoint("page");
export const getGscCountries = dimensionEndpoint("country");
export const getGscDevices = dimensionEndpoint("device");

export const getGscSitemaps = async (req, res) => {
  try {
    const { propertyId } = req.query;
    if (!isValidPropertyId(propertyId)) return res.status(400).json({ success: false, message: "propertyId is required" });
    const sitemaps = await SeoGscSitemap.find({ propertyId }).lean();
    return res.json({ success: true, data: sitemaps });
  } catch (error) {
    console.error("Error fetching GSC sitemaps:", error);
    return res.status(500).json({ success: false, message: "Error fetching sitemaps" });
  }
};

export const inspectGscUrl = async (req, res) => {
  try {
    const { propertyId, url } = req.body;
    if (!isValidPropertyId(propertyId) || typeof url !== "string" || !url)
      return res.status(400).json({ success: false, message: "propertyId and url are required" });
    const connection = await SeoConnection.findOne({ provider: "gsc", propertyId, isActive: true });
    if (!connection) return res.status(404).json({ success: false, message: "GSC connection not found" });

    const client = await getAuthedClientForConnection(connection);
    const result = await inspectUrl({ propertyId, url, authedClient: client });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error inspecting URL:", error);
    return res.status(500).json({ success: false, message: "Error inspecting URL" });
  }
};

export const triggerGscSync = async (req, res) => {
  try {
    await gscSyncQueue.add({}, SYNC_RETRY_CONFIG);
    await logSeoAudit(req, "gsc.sync.trigger", "SeoConnection", null, {});
    return res.json({ success: true, message: "GSC sync queued" });
  } catch (error) {
    console.error("Error triggering GSC sync:", error);
    return res.status(500).json({ success: false, message: "Error triggering sync" });
  }
};

// Exported for reuse/testing — direct synchronous sync of a single property.
export const syncGscPropertyNow = syncGscProperty;
