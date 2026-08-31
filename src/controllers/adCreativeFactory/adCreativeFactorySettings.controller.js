import { getOrCreateAdCreativeFactorySettings } from "../../models/adCreativeFactory/adCreativeFactorySettings.model.js";

export const getSettings = async (req, res) => {
  try {
    const settings = await getOrCreateAdCreativeFactorySettings();
    return res.json({ success: true, data: settings });
  } catch (err) {
    console.error("[AdCreativeFactory] getSettings error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const EDITABLE_FIELDS = [
  "maxDailyCreativeSets",
  "maxRetries",
  "dailyAiBudgetUsd",
  "variantsPerAdSet",
  "platformLengthLimits",
  "complianceKeywordBlocklist",
  "brandVoiceRiskThreshold",
];

export const updateSettings = async (req, res) => {
  try {
    const settings = await getOrCreateAdCreativeFactorySettings();
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        settings[field] = req.body[field];
      }
    }
    await settings.save();
    return res.json({ success: true, data: settings, message: "Settings updated" });
  } catch (err) {
    console.error("[AdCreativeFactory] updateSettings error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const toggleAutomation = async (req, res) => {
  try {
    const settings = await getOrCreateAdCreativeFactorySettings();
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
    console.error("[AdCreativeFactory] toggleAutomation error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
