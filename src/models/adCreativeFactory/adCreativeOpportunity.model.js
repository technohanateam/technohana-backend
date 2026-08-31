import mongoose, { Schema } from "mongoose";

const CAMPAIGN_OBJECTIVES = ["LEAD_GEN", "ENROLLMENT", "BRAND_AWARENESS", "RETARGETING"];
const PLATFORMS = ["META", "LINKEDIN", "BOTH"];

const adVariantSchema = new Schema(
  {
    text: { type: String, required: true },
    charCount: { type: Number, default: 0 },
    platform: { type: String, enum: PLATFORMS.filter((p) => p !== "BOTH"), required: true },
    withinLimit: { type: Boolean, default: true },
  },
  { _id: false }
);

const adCreativeOpportunitySchema = new Schema(
  {
    courseId: { type: String, default: null },
    courseSlug: { type: String, default: null },
    courseTitle: { type: String, default: null },

    campaignObjective: { type: String, enum: CAMPAIGN_OBJECTIVES, required: true },
    platform: { type: String, enum: PLATFORMS, required: true },
    targetAudience: { type: String, default: null },
    angle: { type: String, default: null },

    // Creative brief produced by the BRIEF step, consumed by COPY_DRAFT. Kept
    // inline (Mixed) rather than a separate collection — unlike Content
    // Factory's ContentBrief, there's no dedicated review UI for this, it's
    // just intermediate pipeline state.
    brief: { type: Schema.Types.Mixed, default: null },

    status: {
      type: String,
      enum: [
        "PLANNED",
        "SELECTED",
        "GENERATING",
        "AWAITING_INPUT",
        "HUMAN_REVIEW",
        "NEEDS_REVISION",
        "APPROVED",
        "REJECTED",
        "FAILED",
      ],
      default: "PLANNED",
      index: true,
    },

    creativeDraft: {
      headlines: { type: [adVariantSchema], default: [] },
      primaryTexts: { type: [adVariantSchema], default: [] },
      descriptions: { type: [adVariantSchema], default: [] },
      ctas: { type: [{ text: String, platform: String, _id: false }], default: [] },
    },

    complianceFlags: { type: [String], default: [] },
    autoRevisionCount: { type: Number, default: 0 },
    humanRevisionNote: { type: String, default: null },
    generationAttempts: { type: Number, default: 0 },

    errorMessage: { type: String, default: null },
    retryCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },

    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true }
);

adCreativeOpportunitySchema.index({ status: 1, createdAt: -1 });
adCreativeOpportunitySchema.index({ courseSlug: 1, createdAt: -1 });

const AdCreativeOpportunity = mongoose.model("AdCreativeOpportunity", adCreativeOpportunitySchema);
export default AdCreativeOpportunity;
export { CAMPAIGN_OBJECTIVES, PLATFORMS };
