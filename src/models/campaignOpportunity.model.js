import mongoose, { Schema } from "mongoose";

// Proposed campaigns surfaced by the opportunity-scan job (analog of the
// blog Content Factory's ContentOpportunity) — signals from lead scoring,
// at-risk learners, abandoned enrollments, and expiring coupons get turned
// into a reviewable suggestion instead of firing automatically.
const campaignOpportunitySchema = new Schema({
  type: {
    type: String,
    enum: [
      "at_risk_learners",
      "abandoned_enrollment",
      "hot_leads",
      "expiring_coupon",
      "inactive_users",
    ],
    required: true,
  },
  title: { type: String, required: true, trim: true },
  rationale: { type: String, trim: true },

  // Feeds directly into campaign.segments when the opportunity is approved
  segmentFilter: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Feeds directly into generateCampaignCopy(campaignId, brief)
  suggestedBrief: { type: String, trim: true },
  suggestedSendWindow: { type: String, trim: true },

  matchedCount: { type: Number, default: 0 },
  priorityScore: { type: Number, min: 0, max: 100, default: 0 },

  status: {
    type: String,
    enum: ["proposed", "approved", "dismissed"],
    default: "proposed",
  },
  resultingCampaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
  resolvedBy: mongoose.Schema.Types.ObjectId,
  resolvedAt: Date,

  createdAt: { type: Date, default: Date.now },
});

// One active (proposed) opportunity per type at a time — the scan job
// re-scores an existing one instead of spamming duplicates.
campaignOpportunitySchema.index({ type: 1, status: 1 });

const CampaignOpportunity = mongoose.model("CampaignOpportunity", campaignOpportunitySchema);
export default CampaignOpportunity;
