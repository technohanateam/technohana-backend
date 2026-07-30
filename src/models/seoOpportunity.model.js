import mongoose, { Schema } from "mongoose";

const seoOpportunitySchema = new Schema({
  recordType: {
    type: String,
    enum: ["priority-opportunity", "competitor-gap", "resource-page"],
    required: true,
    index: true,
  },

  // Shared identity fields (natural key for de-dup on sync/import)
  competitor: String,
  referringDomain: String,
  organizationName: String,
  organizationType: String,
  opportunityType: String,
  resourcePageUrl: String,

  // Priority-opportunity / competitor-gap fields
  industry: String,
  industryRelevance: String,
  editorialQuality: String,
  likelihoodOfAcceptance: String,
  trafficQuality: String,
  spamRisk: String,
  estimatedAuthority: String,
  estimatedMonthlyTraffic: String,
  relationshipOpportunity: String,
  contentOpportunity: String,
  linkContext: String,
  targetPage: String,
  potentialForTechnohana: String,
  rationale: String,
  notes: String,
  overallScore: Number,

  // Resource-page fields
  topicFocus: String,
  approvalProbability: String,

  // Shared evidence fields
  priority: { type: String, enum: ["High", "Medium", "Low"], index: true },
  confidence: { type: String, enum: ["High", "Medium", "Low"] },
  evidenceLevel: String,
  evidenceSource: String,
  evidenceUrl: String,
  evidenceNotes: String,
  contentYear: Number,
  authorityUnscored: Boolean,

  // Admin-managed fields (not sourced from CSV)
  status: {
    type: String,
    enum: ["new", "in-progress", "contacted", "approved", "rejected", "published"],
    default: "new",
    index: true,
  },
  assignedOwner: String,
  internalNotes: String,

  // Phase 6 — AI-assisted discovery fields
  contactPageUrl: String,
  contactEmail: String,
  anchorTextSuggestion: String,
  discoveryConfidenceScore: Number, // 0-100, AI-assigned at discovery time
  discoverySource: {
    type: String,
    enum: ["ai-seed", "manual", "csv-import", "competitor-gap-scan"],
    default: "manual",
    index: true,
  },
  lastVerifiedAt: Date, // last time the discovery fetch confirmed contact/robots info is reachable
  robotsAllowed: Boolean,
  discoveryRawNotes: String, // AI's stated rationale for proposing this candidate

  // Phase 6 — additional scoring factor inputs
  trafficPotential: String, // "High"/"Medium"/"Low"
  competitionLevel: String, // "High"/"Medium"/"Low"

  sourceKey: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

seoOpportunitySchema.index({ lastVerifiedAt: 1 });

seoOpportunitySchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const SeoOpportunity = mongoose.model("SeoOpportunity", seoOpportunitySchema);
export default SeoOpportunity;
