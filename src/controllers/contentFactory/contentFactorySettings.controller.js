import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";

export const getSettings = async (req, res) => {
  try {
    const settings = await getOrCreateContentFactorySettings();
    return res.json({ success: true, data: settings });
  } catch (err) {
    console.error("[ContentFactory] getSettings error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const EDITABLE_FIELDS = [
  "targetArticlesPerDay",
  "maxDailyOpportunities",
  "maxDailyArticles",
  "maxDailyResearchCalls",
  "maxRetries",
  "dailyAiBudgetUsd",
  "aiStyleRiskThreshold",
  "autoGenerateArticles",
  "priorityWeights",
  "duplicateThresholds",
];

export const updateSettings = async (req, res) => {
  try {
    const settings = await getOrCreateContentFactorySettings();
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        settings[field] = req.body[field];
      }
    }
    await settings.save();
    return res.json({ success: true, data: settings, message: "Settings updated" });
  } catch (err) {
    console.error("[ContentFactory] updateSettings error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const toggleAutomation = async (req, res) => {
  try {
    const settings = await getOrCreateContentFactorySettings();
    const nextStatus = req.body?.automationStatus === "ENABLED" ? "ENABLED" : req.body?.automationStatus === "PAUSED" ? "PAUSED" : null;
    if (!nextStatus) {
      return res.status(400).json({ success: false, message: "automationStatus must be 'ENABLED' or 'PAUSED'" });
    }

    settings.automationStatus = nextStatus;
    if (nextStatus === "ENABLED") {
      settings.pausedReason = null;
      settings.pausedAt = null;
    } else {
      settings.pausedReason = req.body?.pausedReason || "Paused by admin";
      settings.pausedAt = new Date();
    }
    await settings.save();
    return res.json({ success: true, data: settings, message: `Automation ${nextStatus.toLowerCase()}` });
  } catch (err) {
    console.error("[ContentFactory] toggleAutomation error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
