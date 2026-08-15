import SeoIntelligenceSettings from "../models/seoIntelligenceSettings.model.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

const getOrCreateSettings = async () => {
  let settings = await SeoIntelligenceSettings.findOne();
  if (!settings) settings = await SeoIntelligenceSettings.create({});
  return settings;
};

export const getIntelSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Error fetching SEO intelligence settings:", error);
    return res.status(500).json({ success: false, message: "Error fetching settings" });
  }
};

const EDITABLE_FIELDS = ["crawlBaseUrl", "crawlMaxPages", "crawlConcurrency", "alertThresholds", "alertEmailRecipients"];

// The crawler issues server-side requests to crawlBaseUrl, so an unvalidated
// value is an SSRF sink (cloud metadata, internal hosts). Restrict it to our
// own origins, and fail closed when none are configured.
const allowedCrawlHosts = () => {
  const raw = process.env.FRONTEND_URL || process.env.WHITELISTED_URLS || "";
  return raw
    .split(",")
    .map((entry) => {
      try {
        return new URL(entry.trim()).hostname;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const isValidCrawlBaseUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  return allowedCrawlHosts().includes(url.hostname);
};

export const updateIntelSettings = async (req, res) => {
  try {
    if (req.body.crawlBaseUrl !== undefined && !isValidCrawlBaseUrl(req.body.crawlBaseUrl)) {
      return res.status(400).json({
        success: false,
        message: "crawlBaseUrl must be an http(s) URL on an approved host.",
      });
    }

    const settings = await getOrCreateSettings();
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) settings[field] = req.body[field];
    }
    settings.updatedAt = new Date();
    settings.updatedBy = req.admin?.uid || req.admin?.email;
    await settings.save();

    await logSeoAudit(req, "settings.update", "SeoIntelligenceSettings", settings._id.toString(), req.body);
    return res.json({ success: true, message: "Settings updated", data: settings });
  } catch (error) {
    console.error("Error updating SEO intelligence settings:", error);
    return res.status(500).json({ success: false, message: "Error updating settings" });
  }
};
