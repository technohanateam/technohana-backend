import mongoose, { Schema } from "mongoose";

// Singleton settings doc — mirrors contentFactorySettings.model.js, scoped to
// the Course Factory's own budget so course-lesson generation never eats
// into the existing blog Content Factory's daily AI budget.
const courseFactorySettingsSchema = new Schema(
  {
    dailyAiBudgetUsd: { type: Number, default: 25 },
    todaySpendUsd: { type: Number, default: 0 },
    todaySpendDate: { type: String, default: null },

    automationStatus: { type: String, enum: ["ENABLED", "PAUSED"], default: "ENABLED" },
    pausedReason: { type: String, default: null },
    pausedAt: { type: Date, default: null },
    budgetExceededAt: { type: Date, default: null },

    ttsProvider: { type: String, default: "openai" },
    ttsVoice: { type: String, default: "alloy" },
    ttsLanguage: { type: String, default: "en-IN" },

    defaultModelTier: { type: String, enum: ["cheap", "standard"], default: "standard" },
  },
  { timestamps: true }
);

const CourseFactorySettings = mongoose.model("CourseFactorySettings", courseFactorySettingsSchema);
export default CourseFactorySettings;

export async function getOrCreateCourseFactorySettings() {
  let settings = await CourseFactorySettings.findOne();
  if (!settings) settings = await CourseFactorySettings.create({});
  return settings;
}
