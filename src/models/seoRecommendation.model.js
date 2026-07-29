import mongoose, { Schema } from "mongoose";

const seoRecommendationSchema = new Schema({
  category: { type: String, enum: ["technical", "content", "performance", "gsc", "ga4"], required: true },
  ruleCode: { type: String, required: true },
  title: { type: String, required: true },
  description: String,
  affectedUrl: String,
  priority: { type: String, enum: ["critical", "high", "medium", "low"], required: true },
  impact: { type: String, enum: ["high", "medium", "low"], required: true },
  effort: { type: String, enum: ["low", "medium", "high"], required: true },
  confidence: { type: String, enum: ["high", "medium", "low"], required: true },
  evidence: Schema.Types.Mixed,
  status: { type: String, enum: ["open", "in_progress", "resolved", "dismissed"], default: "open", index: true },
  sourceCrawlRunId: { type: Schema.Types.ObjectId, ref: "SeoCrawlRun" },
  generatedAt: { type: Date, default: Date.now },
  resolvedAt: Date,
  dismissedAt: Date,
});

seoRecommendationSchema.index({ ruleCode: 1, affectedUrl: 1, status: 1 });

const SeoRecommendation = mongoose.model("SeoRecommendation", seoRecommendationSchema);
export default SeoRecommendation;
