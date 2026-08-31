import mongoose, { Schema } from "mongoose";

const OPPORTUNITY_TYPES = [
  "HOT_LEAD_FOLLOWUP",
  "AT_RISK_LEARNER",
  "ABANDONED_ENROLLMENT",
  "COUPON_EXPIRING",
  "INACTIVE_WINBACK",
];

const campaignOpportunitySchema = new Schema(
  {
    type: { type: String, enum: OPPORTUNITY_TYPES, required: true },

    rationale: { type: String, required: true },
    suggestedBrief: { type: String, default: null },

    segmentFilter: { type: Schema.Types.Mixed, default: {} },
    audienceSize: { type: Number, default: 0 },

    suggestedSendWindow: { type: Date, default: null },
    priorityScore: { type: Number, default: 0, min: 0, max: 100 },

    sourceInfo: { type: Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      enum: ["PROPOSED", "APPROVED", "DISMISSED", "EXPIRED"],
      default: "PROPOSED",
      index: true,
    },

    resultingCampaignId: { type: Schema.Types.ObjectId, ref: "Campaign", default: null },

    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

campaignOpportunitySchema.index({ status: 1, priorityScore: -1 });
campaignOpportunitySchema.index({ type: 1, createdAt: -1 });

const CampaignOpportunity = mongoose.model("CampaignOpportunity", campaignOpportunitySchema);
export default CampaignOpportunity;
export { OPPORTUNITY_TYPES };
