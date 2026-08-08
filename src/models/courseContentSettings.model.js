import mongoose, { Schema } from "mongoose";

// 1:1 per-course content-factory settings, keyed by courseSlug — deliberately
// NOT stored on course.model.js, since that collection is overwritten wholesale
// by `npm run sync-prices` (raw file copy from the frontend catalog) and any
// fields living there would be silently dropped on the next sync.
const courseContentSettingsSchema = new Schema(
  {
    courseSlug: { type: String, required: true, unique: true, index: true },
    courseId: { type: String, default: null },

    priorityScore: { type: Number, default: 0 },
    priorityTier: {
      type: String,
      enum: ["TIER_1_STRATEGIC", "TIER_2_GROWTH", "TIER_3_EVERGREEN", "TIER_4_LONG_TAIL"],
      default: "TIER_4_LONG_TAIL",
    },
    // Admin-set override — when present, takes precedence over the computed
    // priorityScore/Tier for callers, but the underlying computed score is
    // still stored separately (above) so the override never erases it.
    priorityOverride: { type: Number, default: null },

    frequency: {
      type: String,
      enum: ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ON_DEMAND"],
      default: "WEEKLY",
    },
    frequencyOverride: {
      type: String,
      enum: ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ON_DEMAND", null],
      default: null,
    },

    enabled: { type: Boolean, default: true },

    lastBlogGeneratedAt: { type: Date, default: null },
    lastBlogPublishedAt: { type: Date, default: null },
    blogsThisMonth: { type: Number, default: 0 },

    lastPriorityComputedAt: { type: Date, default: null },
    lastFreshnessCheckedAt: { type: Date, default: null },
    freshnessStatus: {
      type: String,
      enum: ["FRESH", "REVIEW_RECOMMENDED", "OUTDATED"],
      default: "FRESH",
    },
  },
  { timestamps: true }
);

const CourseContentSettings = mongoose.model("CourseContentSettings", courseContentSettingsSchema);
export default CourseContentSettings;
