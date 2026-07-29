import mongoose, { Schema } from "mongoose";

const seoIntelligenceSettingsSchema = new Schema({
  crawlBaseUrl: { type: String, default: () => process.env.FRONTEND_URL || "" },
  crawlMaxPages: { type: Number, default: 500 },
  crawlConcurrency: { type: Number, default: 5 },
  alertThresholds: {
    trafficDropPercent: { type: Number, default: 20 },
    rankingDropPositions: { type: Number, default: 5 },
    ctrDropPercent: { type: Number, default: 30 },
  },
  alertEmailRecipients: [String],
  updatedAt: { type: Date, default: Date.now },
  updatedBy: String,
});

const SeoIntelligenceSettings = mongoose.model("SeoIntelligenceSettings", seoIntelligenceSettingsSchema);
export default SeoIntelligenceSettings;
