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
    // Milestone 4: YYYY-MM-DD string marking which day todaySpendUsd is for —
    // aiUsageTracker.service.js resets todaySpendUsd to 0 when this doesn't
    // match "today" before incrementing, so spend rolls over daily.
    todaySpendDate: { type: String, default: null },
    aiStyleRiskThreshold: { type: Number, default: 30 },
    // Milestone 3: quality-gate floor — computeQualityGateResult() flags for
    // revision when overallScore falls below this, in addition to the
    // aiStyleRiskThreshold check above.
    overallScoreFloor: { type: Number, default: 60 },
    autoGenerateArticles: { type: Boolean, default: false },
    priorityWeights: {
      type: Schema.Types.Mixed,
      default: () => ({ enquiry: 25, revenue: 25, views: 15, gscClicks: 15, gscImpressions: 10, recency: 10 }),
    },
    duplicateThresholds: {
      type: Schema.Types.Mixed,
      default: () => ({ titleSimilarity: 0.75, keywordOverlap: 0.6 }),
    },
    // Milestone 5: admin-editable keyword list (NOT a fixed category list —
    // the real category taxonomy is long-tail and drifts) used by
    // contentFreshness.service.js to weight blogs more aggressively toward
    // OUTDATED when their category/tags/title match one of these fast-moving
    // topics.
    freshnessSensitiveKeywords: {
      type: [String],
      default: () => ["AI", "GPT", "Claude", "certification", "pricing", "AWS", "Azure", "GCP"],
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
