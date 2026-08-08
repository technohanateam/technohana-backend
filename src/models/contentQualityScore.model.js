import mongoose, { Schema } from "mongoose";

// One doc per generation attempt — never overwritten, so the review UI can
// show full before/after history across an automatic or human-requested
// revision pass (see contentGenerationOrchestrator.service.js / M3).
const factCheckFindingSchema = new Schema(
  {
    claim: { type: String, required: true },
    verifiable: { type: Boolean, default: false },
    note: { type: String, default: null },
    sourceUrl: { type: String, default: null },
  },
  { _id: false }
);

const contentQualityScoreSchema = new Schema(
  {
    opportunityId: { type: Schema.Types.ObjectId, ref: "ContentOpportunity", required: true, index: true },
    generationAttempt: { type: Number, default: 1 },

    // AI-scored dimensions (combined qualityEvaluator call, 0-100 each).
    seoScore: { type: Number, default: 0, min: 0, max: 100 },
    originalityScore: { type: Number, default: 0, min: 0, max: 100 },
    readabilityScore: { type: Number, default: 0, min: 0, max: 100 },
    courseRelevanceScore: { type: Number, default: 0, min: 0, max: 100 },
    searchIntentAlignmentScore: { type: Number, default: 0, min: 0, max: 100 },
    internalLinksScore: { type: Number, default: 0, min: 0, max: 100 },
    factualityScore: { type: Number, default: 0, min: 0, max: 100 },
    ctaRelevanceScore: { type: Number, default: 0, min: 0, max: 100 },
    specificityScore: { type: Number, default: 0, min: 0, max: 100 },
    originalInsightScore: { type: Number, default: 0, min: 0, max: 100 },
    editorialQualityScore: { type: Number, default: 0, min: 0, max: 100 },

    // Inverted dimension — higher = more generic/formulaic/AI-sounding.
    aiStyleRiskScore: { type: Number, default: 0, min: 0, max: 100 },

    overallScore: { type: Number, default: 0, min: 0, max: 100 },

    flaggedForRevision: { type: Boolean, default: false },
    flagReasons: { type: [String], default: [] },

    factCheckFindings: { type: [factCheckFindingSchema], default: [] },

    evaluatedByModel: { type: String, default: null },
  },
  { timestamps: true }
);

contentQualityScoreSchema.index({ opportunityId: 1, generationAttempt: 1, createdAt: -1 });

const ContentQualityScore = mongoose.model("ContentQualityScore", contentQualityScoreSchema);
export default ContentQualityScore;
