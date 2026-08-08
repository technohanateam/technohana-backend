import mongoose, { Schema } from "mongoose";

const duplicateSignalSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["EXACT_DUPLICATE", "TITLE_SIMILARITY", "TOPIC_SIMILARITY", "SEARCH_INTENT_OVERLAP", "KEYWORD_CANNIBALIZATION"],
      required: true,
    },
    matchedAgainstType: { type: String, enum: ["BLOG", "OPPORTUNITY"], required: true },
    matchedAgainstId: { type: String, default: null },
    score: { type: Number, default: 0 },
  },
  { _id: false }
);

const CONTENT_TYPES = [
  "COURSE_GUIDE",
  "HOW_TO",
  "BEGINNER_GUIDE",
  "ADVANCED_GUIDE",
  "TUTORIAL",
  "CAREER",
  "CERTIFICATION",
  "COMPARISON",
  "TRENDING",
  "NEWS_ANALYSIS",
  "CHECKLIST",
  "ROADMAP",
  "BEST_PRACTICES",
  "BUSINESS_USE_CASE",
  "CORPORATE_TRAINING",
  "FAQ",
  "CASE_STUDY",
  "TOOLS",
  "TECHNOLOGY_UPDATE",
  "EXPERT_INSIGHT",
];

const contentOpportunitySchema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, default: null },

    courseId: { type: String, default: null },
    courseSlug: { type: String, default: null },
    courseTitle: { type: String, default: null },

    clusterId: { type: Schema.Types.ObjectId, ref: "TopicCluster", default: null },
    clusterName: { type: String, default: null },

    contentType: { type: String, enum: CONTENT_TYPES, required: true },
    category: { type: String, default: null },

    focusKeyword: { type: String, default: null },
    secondaryKeywords: { type: [String], default: [] },

    searchIntent: {
      type: String,
      enum: ["INFORMATIONAL", "EDUCATIONAL", "COMMERCIAL_INVESTIGATION", "TRANSACTIONAL", "NAVIGATIONAL"],
      default: "INFORMATIONAL",
    },

    businessIntentScore: { type: Number, default: 0, min: 0, max: 100 },
    courseRelevanceScore: { type: Number, default: 0, min: 0, max: 100 },

    targetAudience: { type: String, default: null },
    topicAngle: { type: String, default: null },
    recommendationReason: { type: String, default: null },

    trendScore: { type: Number, default: 0 },
    seoOpportunityScore: { type: Number, default: 0 },

    duplicateScore: { type: Number, default: 0 },
    cannibalizationRisk: { type: String, enum: ["NONE", "LOW", "MEDIUM", "HIGH"], default: "NONE" },
    duplicateSignals: { type: [duplicateSignalSchema], default: [] },

    overallScore: { type: Number, default: 0 },

    sourceInfo: { type: Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      enum: [
        "PLANNED",
        "SELECTED",
        "GENERATING",
        "AI_REVIEW",
        "HUMAN_REVIEW",
        "NEEDS_REVISION",
        "APPROVED",
        "REJECTED",
        "SCHEDULED",
        "PUBLISHED",
        "FAILED",
      ],
      default: "PLANNED",
      index: true,
    },

    resultingBlogId: { type: Schema.Types.ObjectId, ref: "Blogs", default: null },

    errorMessage: { type: String, default: null },
    retryCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },

    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true }
);

contentOpportunitySchema.index({ status: 1, overallScore: -1 });
contentOpportunitySchema.index({ courseSlug: 1, createdAt: -1 });

const ContentOpportunity = mongoose.model("ContentOpportunity", contentOpportunitySchema);
export default ContentOpportunity;
export { CONTENT_TYPES };
