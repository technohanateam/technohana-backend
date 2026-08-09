import mongoose, { Schema } from "mongoose";

const contentRunSchema = new Schema(
  {
    runType: { type: String, enum: ["PLANNING", "GENERATION"], default: "PLANNING" },
    triggeredBy: { type: String, enum: ["CRON", "MANUAL"], required: true },
    status: { type: String, enum: ["RUNNING", "COMPLETE", "FAILED"], default: "RUNNING" },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    coursesEvaluated: { type: Number, default: 0 },
    opportunitiesCreated: { type: Number, default: 0 },
    opportunitiesSkippedDuplicate: { type: Number, default: 0 },
    articlesGenerated: { type: Number, default: 0 },
    errors: { type: [String], default: [] },
    dryRun: { type: Boolean, default: true },
    settingsSnapshot: { type: Schema.Types.Mixed, default: {} },
    // Milestone 5: lightweight summaries of what trendResearch/contentGapAnalysis
    // found this run, so the dashboard's "Trending this week"/"Top SEO gaps"
    // widgets can read them straight off the latest PLANNING ContentRun
    // instead of a new endpoint (reuses the existing GET /runs fetch).
    trendsSummary: { type: [Schema.Types.Mixed], default: [] },
    gapsSummary: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true, suppressReservedKeysWarning: true }
);

const ContentRun = mongoose.model("ContentRun", contentRunSchema);
export default ContentRun;
