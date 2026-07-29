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

export const updateIntelSettings = async (req, res) => {
  try {
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
