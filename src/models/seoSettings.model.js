import mongoose, { Schema } from "mongoose";

// Singleton document (single row) holding admin-configurable SEO Ops settings.
const seoSettingsSchema = new Schema({
  scoringWeights: {
    relevance: { type: Number, default: 30 },
    editorialQuality: { type: Number, default: 20 },
    acceptanceProbability: { type: Number, default: 15 },
    authority: { type: Number, default: 10 },
    relationship: { type: Number, default: 10 },
    content: { type: Number, default: 10 },
    freshness: { type: Number, default: 5 },
  },
  priorityThresholds: {
    high: { type: Number, default: 70 },
    medium: { type: Number, default: 40 },
  },
  defaultOwners: [String],
  validationRules: {
    requireEvidenceUrl: { type: Boolean, default: true },
    minConfidence: { type: String, enum: ["High", "Medium", "Low"], default: "Medium" },
  },

  updatedAt: { type: Date, default: Date.now },
  updatedBy: String,
});

seoSettingsSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const SeoSettings = mongoose.model("SeoSettings", seoSettingsSchema);
export default SeoSettings;
