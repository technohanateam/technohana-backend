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
  },
  { timestamps: true, suppressReservedKeysWarning: true }
);

const ContentRun = mongoose.model("ContentRun", contentRunSchema);
export default ContentRun;
