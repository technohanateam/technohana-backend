import SeoGa4Metric from "../models/seoGa4Metric.model.js";
import { ga4SyncQueue, SYNC_RETRY_CONFIG } from "../services/seoIntelQueue.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";
import { dateRange, isValidPropertyId } from "../utils/seoDateRange.js";

export const getGa4Summary = async (req, res) => {
  try {
    const { propertyId } = req.query;
    if (!isValidPropertyId(propertyId)) return res.status(400).json({ success: false, message: "propertyId is required" });
    const { from, to } = dateRange(req);

    const rows = await SeoGa4Metric.find({ propertyId, dimensionType: "date", date: { $gte: from, $lte: to } }).lean();
    const totals = rows.reduce(
      (acc, r) => ({
        sessions: acc.sessions + r.sessions,
        users: acc.users + r.users,
        conversions: acc.conversions + r.conversions,
      }),
      { sessions: 0, users: 0, conversions: 0 }
    );
    // Weighted by sessions, matching how avgCtr/avgPosition are weighted in
    // the GSC controller — an unweighted per-row average lets a low-traffic
    // page skew the reported bounce rate as much as a high-traffic one.
    const avgBounceRate = totals.sessions > 0 ? rows.reduce((s, r) => s + r.bounceRate * r.sessions, 0) / totals.sessions : 0;

    return res.json({ success: true, data: { totals: { ...totals, bounceRate: avgBounceRate } } });
  } catch (error) {
    console.error("Error fetching GA4 summary:", error);
    return res.status(500).json({ success: false, message: "Error fetching GA4 summary" });
  }
};

const dimensionEndpoint = (dimensionType) => async (req, res) => {
  try {
    const { propertyId } = req.query;
    if (!isValidPropertyId(propertyId)) return res.status(400).json({ success: false, message: "propertyId is required" });
    const { from, to } = dateRange(req);
    const rows = await SeoGa4Metric.find({ propertyId, dimensionType, date: { $gte: from, $lte: to } })
      .sort({ sessions: -1 })
      .limit(200)
      .lean();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error(`Error fetching GA4 ${dimensionType}:`, error);
    return res.status(500).json({ success: false, message: `Error fetching GA4 ${dimensionType}` });
  }
};

export const getGa4LandingPages = dimensionEndpoint("landingPage");
export const getGa4Events = dimensionEndpoint("event");
export const getGa4TrafficSources = dimensionEndpoint("trafficSource");

export const triggerGa4Sync = async (req, res) => {
  try {
    await ga4SyncQueue.add({}, SYNC_RETRY_CONFIG);
    await logSeoAudit(req, "ga4.sync.trigger", "SeoConnection", null, {});
    return res.json({ success: true, message: "GA4 sync queued" });
  } catch (error) {
    console.error("Error triggering GA4 sync:", error);
    return res.status(500).json({ success: false, message: "Error triggering sync" });
  }
};
