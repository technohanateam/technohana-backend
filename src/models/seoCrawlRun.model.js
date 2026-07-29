import mongoose, { Schema } from "mongoose";

const seoCrawlRunSchema = new Schema({
  baseUrl: { type: String, required: true },
  startedAt: { type: Date, default: Date.now },
  finishedAt: Date,
  status: { type: String, enum: ["running", "completed", "failed"], default: "running" },
  error: String,
  pagesCrawled: { type: Number, default: 0 },
  pagesErrored: { type: Number, default: 0 },
  pagesSkippedRobots: { type: Number, default: 0 },
  summary: {
    missingTitle: { type: Number, default: 0 },
    titleTooLong: { type: Number, default: 0 },
    missingMetaDescription: { type: Number, default: 0 },
    metaTooLong: { type: Number, default: 0 },
    duplicateTitles: { type: Number, default: 0 },
    duplicateDescriptions: { type: Number, default: 0 },
    brokenLinks: { type: Number, default: 0 },
    missingH1: { type: Number, default: 0 },
    multipleH1: { type: Number, default: 0 },
    largeImages: { type: Number, default: 0 },
    missingAlt: { type: Number, default: 0 },
    brokenImages: { type: Number, default: 0 },
    missingCanonical: { type: Number, default: 0 },
    noindexPages: { type: Number, default: 0 },
    slowPages: { type: Number, default: 0 },
    thinPages: { type: Number, default: 0 },
    orphanPages: { type: Number, default: 0 },
  },
  triggeredBy: { type: String, enum: ["cron", "manual"], default: "manual" },
});

const SeoCrawlRun = mongoose.model("SeoCrawlRun", seoCrawlRunSchema);
export default SeoCrawlRun;
