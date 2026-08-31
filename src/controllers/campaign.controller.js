import Campaign from "../models/campaign.model.js";
import CampaignOpportunity from "../models/campaignOpportunity.model.js";
import { Resend } from "resend";
import { getSegmentedUsers } from "../utils/segmentationEngine.js";
import { scheduleCampaignJob, getQueueStats } from "../services/campaignQueue.js";
import { personalizeHtmlForRecipient } from "../services/emailMarketing/campaignPersonalizer.js";
import { runCampaignOpportunityScan } from "../services/emailMarketing/campaignOpportunityJob.js";
import { generateAndGateCampaignCopy } from "../services/emailMarketing/campaignGenerationOrchestrator.js";
import { buildRegexQuery } from "../utils/escapeRegex.js";

const resend = new Resend(process.env.RESEND_API_KEY);

// Get all campaigns (with pagination & filters)
export const getAllCampaigns = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (search) {
      const regex = buildRegexQuery(search);
      if (regex) {
        filter.$or = [{ name: regex }];
      }
    }
    if (status) {
      filter.status = status;
    }

    const total = await Campaign.countDocuments(filter);
    const campaigns = await Campaign.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .select(
        "name description subject status triggerType schedule metrics createdAt sentAt"
      )
      .lean();

    return res.json({
      success: true,
      data: campaigns.map((c) => {
        // .lean() strips instance methods, so compute rates inline (mirrors campaignSchema.methods.calculateMetrics)
        const total = c.metrics?.totalSent || 0;
        const rate = (n) => (total > 0 ? ((n / total) * 100).toFixed(2) : 0);
        return {
          ...c,
          metrics: {
            ...c.metrics,
            openRate: rate(c.metrics?.opened || 0),
            clickRate: rate(c.metrics?.clicked || 0),
            bounceRate: rate(c.metrics?.bounced || 0),
            deliveryRate: rate(c.metrics?.delivered || 0),
          },
        };
      }),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error fetching campaigns:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching campaigns",
    });
  }
};

// Get single campaign
export const getCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const campaign = await Campaign.findById(id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    return res.json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    console.error("Error fetching campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching campaign",
    });
  }
};

// Create campaign
export const createCampaign = async (req, res) => {
  try {
    const {
      name,
      description,
      subject,
      htmlContent,
      previewText,
      segments,
      triggerType,
      schedule,
      eventTrigger,
      variants,
    } = req.body;

    if (!name || !subject || !htmlContent) {
      return res.status(400).json({
        success: false,
        message: "Name, subject, and content are required",
      });
    }

    const campaign = new Campaign({
      name,
      description,
      subject,
      htmlContent,
      previewText,
      segments: segments || {},
      triggerType,
      schedule,
      eventTrigger,
      variants: variants || [],
      createdBy: req.admin?._id,
      createdByRole: req.admin?.role,
      status: "draft",
    });

    await campaign.save();

    return res.status(201).json({
      success: true,
      message: "Campaign created successfully",
      data: campaign,
    });
  } catch (error) {
    console.error("Error creating campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating campaign",
    });
  }
};

// Update campaign
export const updateCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    // Can only edit if not already sent/running
    if (!["draft", "scheduled"].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        message: "Can only edit campaigns in draft or scheduled status",
      });
    }

    Object.assign(campaign, updates);
    await campaign.save();

    return res.json({
      success: true,
      message: "Campaign updated successfully",
      data: campaign,
    });
  } catch (error) {
    console.error("Error updating campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating campaign",
    });
  }
};

// Delete campaign
export const deleteCampaign = async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await Campaign.findByIdAndDelete(id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    return res.json({
      success: true,
      message: "Campaign deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting campaign",
    });
  }
};

// Send campaign immediately (direct send via Resend, no queue required)
export const sendCampaignNow = async (req, res) => {
  try {
    const { id } = req.params;
    const campaign = await Campaign.findById(id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    if (campaign.status !== "draft" && campaign.status !== "scheduled") {
      return res.status(400).json({
        success: false,
        message: "Can only send campaigns in draft or scheduled status",
      });
    }

    if (["pending_review", "needs_revision"].includes(campaign.reviewStatus)) {
      return res.status(400).json({
        success: false,
        message: `Campaign copy is ${campaign.reviewStatus.replace("_", " ")} — approve it before sending`,
      });
    }

    // Get all segmented users (no limit cap for actual send)
    const { users, total } = await getSegmentedUsers(campaign.segments, {
      limit: 50000,
    });

    if (total === 0) {
      return res.status(400).json({
        success: false,
        message: "No users matched the campaign segments",
      });
    }

    campaign.status = "running";
    campaign.sentAt = new Date();
    campaign.metrics.totalSent = total;
    await campaign.save();

    let sentCount = 0;
    let failedCount = 0;

    // Send in batches of 100
    const batchSize = 100;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (user) => {
          try {
            const html = campaign.personalize
              ? await personalizeHtmlForRecipient(campaign.htmlContent, user)
              : campaign.htmlContent;
            const response = await resend.emails.send({
              from: `${campaign.fromName} <${campaign.fromEmail}>`,
              to: user.email,
              subject: campaign.subject,
              html,
              headers: {
                "X-Campaign-ID": campaign._id.toString(),
                "X-User-ID": user._id?.toString() || user.email,
              },
              tags: [{ name: "campaign_id", value: campaign._id.toString() }],
            });
            campaign.recipientMetrics.push({
              userId: user._id,
              email: user.email,
              status: "sent",
              sentAt: new Date(),
              variant: "default",
              resendEmailId: response?.data?.id,
            });
            campaign.metrics.delivered++;
            sentCount++;
          } catch (sendError) {
            console.error(`[Campaign] Failed to send to ${user.email}:`, sendError.message);
            campaign.recipientMetrics.push({
              email: user.email,
              status: "failed",
              sentAt: new Date(),
            });
            campaign.metrics.bounced++;
            failedCount++;
          }
        })
      );
    }

    campaign.status = "completed";
    campaign.completedAt = new Date();
    await campaign.save();

    console.log(`[Campaign] "${campaign.name}" completed: ${sentCount} sent, ${failedCount} failed`);

    return res.json({
      success: true,
      message: `Campaign sent: ${sentCount} delivered, ${failedCount} failed`,
      data: { sentCount, failedCount, total },
    });
  } catch (error) {
    console.error("Error sending campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Error sending campaign",
      error: error.message,
    });
  }
};

// Schedule campaign for later
export const scheduleCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const { sendAt } = req.body;

    if (!sendAt) {
      return res.status(400).json({
        success: false,
        message: "sendAt datetime is required",
      });
    }

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    if (["pending_review", "needs_revision"].includes(campaign.reviewStatus)) {
      return res.status(400).json({
        success: false,
        message: `Campaign copy is ${campaign.reviewStatus.replace("_", " ")} — approve it before scheduling`,
      });
    }

    campaign.status = "scheduled";
    campaign.schedule = {
      sendAt: new Date(sendAt),
      timezone: "UTC",
    };
    campaign.triggerType = "schedule";

    await campaign.save();

    // Schedule job with Bull queue
    const job = await scheduleCampaignJob(campaign._id.toString(), sendAt);

    return res.json({
      success: true,
      message: `Campaign scheduled for ${sendAt}`,
      data: campaign,
      jobId: job.id,
    });
  } catch (error) {
    console.error("Error scheduling campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Error scheduling campaign",
    });
  }
};

// Pause campaign
export const pauseCampaign = async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    if (campaign.status === "running") {
      campaign.status = "paused";
      campaign.isPaused = true;
      campaign.pausedAt = new Date();
      await campaign.save();
    }

    return res.json({
      success: true,
      message: "Campaign paused",
      data: campaign,
    });
  } catch (error) {
    console.error("Error pausing campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Error pausing campaign",
    });
  }
};

// Resume campaign
export const resumeCampaign = async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    if (campaign.status === "paused") {
      campaign.status = "running";
      campaign.isPaused = false;
      campaign.resumedAt = new Date();
      await campaign.save();
    }

    return res.json({
      success: true,
      message: "Campaign resumed",
      data: campaign,
    });
  } catch (error) {
    console.error("Error resuming campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Error resuming campaign",
    });
  }
};

// Get campaign analytics
export const getCampaignAnalytics = async (req, res) => {
  try {
    const { id } = req.params;

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const metrics = {
      ...campaign.metrics.toObject(),
      ...{
        openRate: campaign.metrics.totalSent > 0
          ? ((campaign.metrics.opened / campaign.metrics.totalSent) * 100).toFixed(2)
          : 0,
        clickRate: campaign.metrics.totalSent > 0
          ? ((campaign.metrics.clicked / campaign.metrics.totalSent) * 100).toFixed(2)
          : 0,
        bounceRate: campaign.metrics.totalSent > 0
          ? ((campaign.metrics.bounced / campaign.metrics.totalSent) * 100).toFixed(2)
          : 0,
        deliveryRate: campaign.metrics.totalSent > 0
          ? ((campaign.metrics.delivered / campaign.metrics.totalSent) * 100).toFixed(2)
          : 0,
      },
    };

    return res.json({
      success: true,
      data: {
        campaign: {
          name: campaign.name,
          status: campaign.status,
          sentAt: campaign.sentAt,
          completedAt: campaign.completedAt,
        },
        metrics,
        topRecipients: campaign.recipientMetrics
          .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
          .slice(0, 20),
      },
    });
  } catch (error) {
    console.error("Error fetching campaign analytics:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching campaign analytics",
    });
  }
};

// Estimate segment size (preview)
export const estimateSegmentSize = async (req, res) => {
  try {
    const { segments } = req.body;

    const { users, total } = await getSegmentedUsers(segments, { limit: 100 });

    return res.json({
      success: true,
      estimatedSize: total,
      preview: users.slice(0, 10).map((u) => ({
        email: u.email,
        name: u.name,
      })),
    });
  } catch (error) {
    console.error("Error estimating segment size:", error);
    return res.status(500).json({
      success: false,
      message: "Error estimating segment size",
    });
  }
};

// Get queue stats (admin only)
export const getCampaignQueueStats = async (req, res) => {
  try {
    const stats = await getQueueStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching queue stats:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching queue stats",
    });
  }
};

// Generates AI copy for a campaign and runs it through the quality gate
// before it's sendable — replaces the old "generate and trust it" flow.
export const generateAICopy = async (req, res) => {
  try {
    const { brief } = req.body;
    if (!brief || brief.trim().length < 10) {
      return res.status(400).json({ success: false, message: "Brief must be at least 10 characters" });
    }

    const gateResult = await generateAndGateCampaignCopy(req.params.id, brief);
    const campaign = await Campaign.findById(req.params.id);
    res.json({
      success: true,
      data: { copy: campaign, qualityGate: gateResult },
      message: gateResult.passed
        ? "AI copy generated, passed the quality gate, and is ready to send"
        : "AI copy generated but needs human review before it can be sent",
    });
  } catch (err) {
    console.error("generateAICopy error:", err);
    res.status(500).json({ success: false, message: "AI copy generation failed" });
  }
};

// Human review — approve AI-drafted copy that needs a second look before sending
export const approveCampaignCopy = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    campaign.reviewStatus = "approved";
    await campaign.save();
    res.json({ success: true, data: campaign, message: "Campaign copy approved" });
  } catch (err) {
    console.error("approveCampaignCopy error:", err);
    res.status(500).json({ success: false, message: "Error approving campaign copy" });
  }
};

// Human review — reject and require a fresh brief before re-generating
export const rejectCampaignCopy = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    campaign.reviewStatus = "needs_revision";
    await campaign.save();
    res.json({ success: true, data: campaign, message: "Campaign copy marked as needing revision" });
  } catch (err) {
    console.error("rejectCampaignCopy error:", err);
    res.status(500).json({ success: false, message: "Error rejecting campaign copy" });
  }
};

// Runs a fresh opportunity scan on demand (also runs automatically on a
// daily interval — see src/index.js)
export const runOpportunityScan = async (req, res) => {
  try {
    const result = await runCampaignOpportunityScan();
    res.json({ success: true, data: result, message: `Scan complete — ${result.created} new opportunity(ies) proposed` });
  } catch (err) {
    console.error("runOpportunityScan error:", err);
    res.status(500).json({ success: false, message: "Opportunity scan failed" });
  }
};

export const getCampaignOpportunities = async (req, res) => {
  try {
    const { status = "proposed" } = req.query;
    const opportunities = await CampaignOpportunity.find({ status }).sort({ priorityScore: -1, createdAt: -1 }).lean();
    res.json({ success: true, data: opportunities });
  } catch (err) {
    console.error("getCampaignOpportunities error:", err);
    res.status(500).json({ success: false, message: "Error fetching campaign opportunities" });
  }
};

// Approving an opportunity creates a draft Campaign pre-filled with the
// opportunity's segment + brief, ready to run through AI copy generation.
export const approveCampaignOpportunity = async (req, res) => {
  try {
    const opportunity = await CampaignOpportunity.findById(req.params.id);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });
    if (opportunity.status !== "proposed") {
      return res.status(400).json({ success: false, message: `Opportunity already ${opportunity.status}` });
    }

    const campaign = await Campaign.create({
      name: opportunity.title,
      description: opportunity.rationale,
      subject: "(pending AI copy generation)",
      htmlContent: "<p>(pending AI copy generation)</p>",
      segments: opportunity.segmentFilter || {},
      triggerType: "manual",
      status: "draft",
      reviewStatus: "not_applicable",
      sourceOpportunityId: opportunity._id,
      createdBy: req.admin?._id,
      createdByRole: req.admin?.role,
    });

    opportunity.status = "approved";
    opportunity.resultingCampaignId = campaign._id;
    opportunity.resolvedBy = req.admin?._id;
    opportunity.resolvedAt = new Date();
    await opportunity.save();

    res.json({ success: true, data: { campaign, opportunity }, message: "Draft campaign created from opportunity" });
  } catch (err) {
    console.error("approveCampaignOpportunity error:", err);
    res.status(500).json({ success: false, message: "Error approving opportunity" });
  }
};

export const dismissCampaignOpportunity = async (req, res) => {
  try {
    const opportunity = await CampaignOpportunity.findById(req.params.id);
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });
    opportunity.status = "dismissed";
    opportunity.resolvedBy = req.admin?._id;
    opportunity.resolvedAt = new Date();
    await opportunity.save();
    res.json({ success: true, data: opportunity, message: "Opportunity dismissed" });
  } catch (err) {
    console.error("dismissCampaignOpportunity error:", err);
    res.status(500).json({ success: false, message: "Error dismissing opportunity" });
  }
};

export default {
  getAllCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaignNow,
  scheduleCampaign,
  pauseCampaign,
  resumeCampaign,
  getCampaignAnalytics,
  estimateSegmentSize,
  getCampaignQueueStats,
  generateAICopy,
  approveCampaignCopy,
  rejectCampaignCopy,
  runOpportunityScan,
  getCampaignOpportunities,
  approveCampaignOpportunity,
  dismissCampaignOpportunity,
};
