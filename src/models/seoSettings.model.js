import mongoose, { Schema } from "mongoose";

// Singleton document (single row) holding admin-configurable SEO Ops settings.
const seoSettingsSchema = new Schema({
  // Phase 6 — 8-factor weighting (sums to 100), read by recomputeOpportunityScores().
  // `relationship`/`content` are kept only for back-compat with any code still
  // reading the old 7-factor keys directly; recomputeOpportunityScores() reads
  // the new keys.
  scoringWeights: {
    relevance: { type: Number, default: 25 },
    authority: { type: Number, default: 15 },
    trafficPotential: { type: Number, default: 10 },
    editorialQuality: { type: Number, default: 15 },
    acceptanceProbability: { type: Number, default: 10 },
    partnershipPotential: { type: Number, default: 10 },
    competition: { type: Number, default: 10 },
    freshness: { type: Number, default: 5 },
    // deprecated, superseded by partnershipPotential/trafficPotential/competition above
    relationship: { type: Number, default: 10 },
    content: { type: Number, default: 10 },
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

  // Phase 6 — automated verification (Module 5) configuration
  backlinkVerification: {
    rateLimitMs: { type: Number, default: 3000 },
    userAgent: { type: String, default: "TechnohanaBacklinkBot/1.0 (+https://technohana.com/bot)" },
    requestTimeoutMs: { type: Number, default: 10000 },
    maxRedirects: { type: Number, default: 5 },
  },

  // Phase 6 — AI-seeded discovery (Module 1) configuration
  discovery: {
    candidatesPerRun: { type: Number, default: 15 },
    categoriesSeedList: { type: [String], default: [] },
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
