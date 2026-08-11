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

    // Adjustable without a code deploy if a course's lessons routinely need
    // more room than the default (measured need on the pilot lesson: ~10k
    // output tokens for a 14-slide lesson) — see truncation handling in
    // lessonContentGenerator.service.js.
    lessonContentMaxTokens: { type: Number, default: 16000 },
    // A 6-module/24-lesson blueprint measured 3612 output tokens against the
    // old 4096 cap — 88% of budget, too close for comfort on larger courses.
    blueprintMaxTokens: { type: Number, default: 8000 },

    // Admin-configurable TTS pricing — approximate, NOT exact billing (same
    // caveat as the Claude COST_PER_1K_TOKENS tables elsewhere in the
    // codebase). $ per character of narration text sent to the TTS provider.
    ttsCostPerCharUsd: { type: Number, default: 0.000015 },
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
