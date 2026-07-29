import SeoSettings from "../models/seoSettings.model.js";

const getOrCreateSettings = async () => {
  let settings = await SeoSettings.findOne();
  if (!settings) settings = await SeoSettings.create({});
  return settings;
};

export const getSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    return res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Error fetching SEO settings:", error);
    return res.status(500).json({ success: false, message: "Error fetching SEO settings" });
  }
};

const EDITABLE_FIELDS = ["scoringWeights", "priorityThresholds", "defaultOwners", "validationRules"];

export const updateSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) settings[field] = req.body[field];
    }
    settings.updatedBy = req.admin?.uid || req.admin?.email;
    await settings.save();
    return res.json({ success: true, message: "Settings updated", data: settings });
  } catch (error) {
    console.error("Error updating SEO settings:", error);
    return res.status(500).json({ success: false, message: "Error updating SEO settings" });
  }
};
