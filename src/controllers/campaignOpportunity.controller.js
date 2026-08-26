import CampaignOpportunity from "../models/campaignOpportunity.model.js";
import Campaign from "../models/campaign.model.js";

export const getAllOpportunities = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const opportunities = await CampaignOpportunity.find(filter).sort({ priorityScore: -1, createdAt: -1 }).limit(100);
    res.json({ success: true, data: opportunities });
  } catch (err) {
    console.error("getAllOpportunities error:", err);
    res.status(500).json({ success: false, message: "Error fetching opportunities" });
  }
};

export const runOpportunityScanNow = async (req, res) => {
  try {
    const { enqueueOpportunityScanNow } = await import("../services/emailMarketing/campaignOpportunityQueue.js");
    const job = await enqueueOpportunityScanNow();
    res.json({ success: true, message: "Opportunity scan queued", jobId: job.id });
  } catch (err) {
    console.error("runOpportunityScanNow error:", err);
    res.status(500).json({ success: false, message: "Error queuing opportunity scan" });
  }
};

// Approving an opportunity creates a draft Campaign pre-filled from the
// opportunity's suggested segment/brief, and links the two records together.
export const approveOpportunity = async (req, res) => {
  try {
    const opportunity = await CampaignOpportunity.findById(req.params.id);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });
    if (opportunity.status !== "PROPOSED") {
      return res.status(400).json({ success: false, message: `Opportunity is already ${opportunity.status}` });
    }

    const campaign = new Campaign({
      name: `[AI Suggested] ${opportunity.type.replace(/_/g, " ")}`,
      description: opportunity.rationale,
      subject: "Draft — pending AI copy generation",
      htmlContent: "<p>Draft — pending AI copy generation</p>",
      segments: opportunity.segmentFilter || {},
      triggerType: "manual",
      status: "draft",
      sourceOpportunityId: opportunity._id,
      createdBy: req.admin?._id,
      createdByRole: req.admin?.role,
    });
    await campaign.save();

    opportunity.status = "APPROVED";
    opportunity.resultingCampaignId = campaign._id;
    opportunity.reviewedBy = req.admin?.email || req.admin?._id?.toString() || "admin";
    opportunity.reviewedAt = new Date();
    await opportunity.save();

    res.json({ success: true, message: "Opportunity approved — draft campaign created", data: { opportunity, campaign } });
  } catch (err) {
    console.error("approveOpportunity error:", err);
    res.status(500).json({ success: false, message: "Error approving opportunity" });
  }
};

export const dismissOpportunity = async (req, res) => {
  try {
    const opportunity = await CampaignOpportunity.findById(req.params.id);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });

    opportunity.status = "DISMISSED";
    opportunity.reviewedBy = req.admin?.email || req.admin?._id?.toString() || "admin";
    opportunity.reviewedAt = new Date();
    await opportunity.save();

    res.json({ success: true, message: "Opportunity dismissed", data: opportunity });
  } catch (err) {
    console.error("dismissOpportunity error:", err);
    res.status(500).json({ success: false, message: "Error dismissing opportunity" });
  }
};

export default {
  getAllOpportunities,
  runOpportunityScanNow,
  approveOpportunity,
  dismissOpportunity,
};
