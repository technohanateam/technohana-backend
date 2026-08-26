import mongoose, { Schema } from "mongoose";

// Singleton document (single row, found via .findOne()) holding admin-configurable
// Ad Creative Factory settings. Deliberately a sibling of ContentFactorySettings,
// not an extension — the two track independent AI budgets so ad-copy spend
// never silently eats the blog-content budget or vice versa.
const adCreativeFactorySettingsSchema = new Schema(
  {
    automationStatus: { type: String, enum: ["ENABLED", "PAUSED"], default: "PAUSED" },
    maxDailyCreativeSets: { type: Number, default: 5 },
    maxRetries: { type: Number, default: 3 },

    dailyAiBudgetUsd: { type: Number, default: 2 },
    todaySpendUsd: { type: Number, default: 0 },
    // YYYY-MM-DD string marking which day todaySpendUsd is for — the usage
    // tracker resets todaySpendUsd to 0 when this doesn't match "today"
    // before incrementing, same rollover contract as ContentFactorySettings.
    todaySpendDate: { type: String, default: null },

    variantsPerAdSet: { type: Number, default: 3 },
    platformLengthLimits: {
      type: Schema.Types.Mixed,
      default: () => ({
        meta: { headline: 40, primaryText: 125, description: 30 },
        linkedin: { headline: 70, primaryText: 150, description: 100 },
      }),
    },
    complianceKeywordBlocklist: {
      type: [String],
      default: () => ["guaranteed job", "guaranteed placement", "highest-paying", "100% placement", "guaranteed salary", "no experience needed"],
    },
    brandVoiceRiskThreshold: { type: Number, default: 30 },

    pausedReason: { type: String, default: null },
    pausedAt: { type: Date, default: null },
    budgetExceededAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const AdCreativeFactorySettings = mongoose.model("AdCreativeFactorySettings", adCreativeFactorySettingsSchema);
export default AdCreativeFactorySettings;

// Returns the singleton settings doc, creating it with defaults on first use.
export async function getOrCreateAdCreativeFactorySettings() {
  let settings = await AdCreativeFactorySettings.findOne();
  if (!settings) settings = await AdCreativeFactorySettings.create({});
  return settings;
}
