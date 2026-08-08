import mongoose, { Schema } from "mongoose";

// One row per tracked AI call across the Content Factory (Milestone 4). Not a
// strict callType enum since call sites grow across milestones — free string,
// documented examples below for reference.
// Examples: "brief", "article", "seo", "links", "imagePrompt", "factCheck",
// "aiStyleEval", "qualityEval", "revision", "opportunityCandidates",
// "clusterMapping", "trendResearch", "gapAnalysis".
const aiUsageLogSchema = new Schema(
  {
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    callType: { type: String, required: true },
    model: { type: String, default: null },
    tier: { type: String, default: null },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    estimatedCostUsd: { type: Number, default: 0 },
    opportunityId: { type: Schema.Types.ObjectId, ref: "ContentOpportunity", default: null },
    jobId: { type: Schema.Types.ObjectId, ref: "ContentGenerationJob", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

aiUsageLogSchema.index({ date: 1, callType: 1 });

const AiUsageLog = mongoose.model("AiUsageLog", aiUsageLogSchema);
export default AiUsageLog;
