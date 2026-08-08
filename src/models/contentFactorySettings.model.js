import mongoose, { Schema } from "mongoose";

// Singleton document (single row, found via .findOne()) holding admin-configurable
// AI Content Factory settings — mirrors the seoSettings.model.js singleton pattern.
const contentFactorySettingsSchema = new Schema(
  {
    automationStatus: { type: String, enum: ["ENABLED", "PAUSED"], default: "PAUSED" },
    targetArticlesPerDay: {
      min: { type: Number, default: 5 },
      softMax: { type: Number, default: 10 },
    },
    maxDailyOpportunities: { type: Number, default: 20 },
    maxDailyArticles: { type: Number, default: 8 },
    maxDailyResearchCalls: { type: Number, default: 15 },
    maxRetries: { type: Number, default: 3 },
    dailyAiBudgetUsd: { type: Number, default: 20 },
    todaySpendUsd: { type: Number, default: 0 },
    aiStyleRiskThreshold: { type: Number, default: 30 },
    autoGenerateArticles: { type: Boolean, default: false },
    priorityWeights: {
      type: Schema.Types.Mixed,
      default: () => ({ enquiry: 25, revenue: 25, views: 15, gscClicks: 15, gscImpressions: 10, recency: 10 }),
    },
    duplicateThresholds: {
      type: Schema.Types.Mixed,
      default: () => ({ titleSimilarity: 0.75, keywordOverlap: 0.6 }),
    },
    pausedReason: { type: String, default: null },
    pausedAt: { type: Date, default: null },
    budgetExceededAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const ContentFactorySettings = mongoose.model("ContentFactorySettings", contentFactorySettingsSchema);
export default ContentFactorySettings;

// Returns the singleton settings doc, creating it with defaults on first use.
export async function getOrCreateContentFactorySettings() {
  let settings = await ContentFactorySettings.findOne();
  if (!settings) settings = await ContentFactorySettings.create({});
  return settings;
}
