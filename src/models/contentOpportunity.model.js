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
        "AWAITING_INPUT",
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

    // ── Milestone 2: content generation ──────────────────────────────────────
    humanRevisionNote: { type: String, default: null },
    generationAttempts: { type: Number, default: 0 },

    // ── Milestone 3: quality gate / revision ─────────────────────────────────
    // Counts ONLY the fully-automatic revision pass the orchestrator runs
    // inside the quality gate — capped at 1 there. Human-requested revisions
    // via the review UI do NOT increment this (see humanReview.controller.js).
    autoRevisionCount: { type: Number, default: 0 },

    imageConcept: {
      prompt: { type: String, default: null },
      altText: { type: String, default: null },
      suggestedFilename: { type: String, default: null },
      // AI_PROMPT_ONLY is the only tier this build ever produces — real image
      // generation (AI_GENERATED) is explicitly out of scope for this project.
      tier: { type: String, enum: ["AI_GENERATED", "AI_PROMPT_ONLY", "MANUAL_UPLOAD"], default: "AI_PROMPT_ONLY" },
      imageUrl: { type: String, default: null },
      status: { type: String, enum: ["IMAGE_PENDING", "IMAGE_READY", "IMAGE_FAILED"], default: "IMAGE_PENDING" },
    },

    // Mirrors the Blogs schema fields 1:1 on purpose so approval can copy
    // fields directly onto a new Blogs document.
    articleDraft: {
      title: { type: String, default: null },
      slug: { type: String, default: null },
      content: { type: String, default: null }, // HTML
      excerpt: { type: String, default: null },
      metaTitle: { type: String, default: null },
      metaDescription: { type: String, default: null },
      tags: { type: [String], default: [] },
      readTimeMin: { type: Number, default: null },
      sources: { type: [{ title: String, url: String, _id: false }], default: [] },
      faqs: { type: [{ question: String, answer: String, _id: false }], default: [] },
      suggestedInternalLinks: {
        courses: { type: [{ courseSlug: String, anchorText: String, reason: String, _id: false }], default: [] },
        blogs: { type: [{ blogId: String, anchorText: String, reason: String, _id: false }], default: [] },
      },
      // Extra convenience fields threaded through generation (not part of the
      // Blogs schema itself, but needed so approve() can populate the new
      // Blogs doc's author/category/focusKeyword without re-deriving them).
      focusKeyword: { type: String, default: null },
      author: { type: String, default: null },
      category: { type: String, default: null },
    },
  },
  { timestamps: true }
);

contentOpportunitySchema.index({ status: 1, overallScore: -1 });
contentOpportunitySchema.index({ courseSlug: 1, createdAt: -1 });

const ContentOpportunity = mongoose.model("ContentOpportunity", contentOpportunitySchema);
export default ContentOpportunity;
export { CONTENT_TYPES };
