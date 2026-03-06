import Campaign from "../models/campaign.model.js";
import { Resend } from "resend";
import { getSegmentedUsers } from "../utils/segmentationEngine.js";

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
      filter.$or = [{ name: { $regex: search, $options: "i" } }];
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
      data: campaigns.map((c) => ({
        ...c,
        metrics: {
          ...c.metrics,
          ...c.calculateMetrics?.(),
        },
      })),
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
      createdBy: req.user?.id, // Assumes authenticated admin
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

    // Can only edit if in draft status
    if (campaign.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Can only edit campaigns in draft status",
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

// Send campaign immediately (manual trigger)
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

    // Get segmented users
    const { users } = await getSegmentedUsers(campaign.segments, {
      limit: 50000,
    });

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No users matched the campaign segments",
      });
    }

    // Send emails via Resend
    campaign.status = "running";
    campaign.metrics.totalSent = users.length;

    try {
      for (const user of users) {
        try {
          // Select variant (if A/B testing)
          let emailSubject = campaign.subject;
          let emailContent = campaign.htmlContent;

          if (campaign.variants && campaign.variants.length > 0) {
            const variant = campaign.variants[Math.floor(Math.random() * campaign.variants.length)];
            emailSubject = variant.subject || campaign.subject;
            emailContent = variant.htmlContent || campaign.htmlContent;
          }

          // Send via Resend
          const response = await resend.emails.send({
            from: `${campaign.fromName} <${campaign.fromEmail}>`,
            to: user.email,
            subject: emailSubject,
            html: emailContent,
            // Custom headers for tracking
            headers: {
              "X-Campaign-ID": campaign._id.toString(),
              "X-User-ID": user._id?.toString() || user.email,
            },
          });

          // Log recipient
          campaign.recipientMetrics.push({
            userId: user._id,
            email: user.email,
            status: "sent",
            sentAt: new Date(),
            variant: campaign.variants?.length > 0 ? "variant" : "default",
          });

          campaign.metrics.delivered++;
        } catch (sendError) {
          console.error(`Failed to send to ${user.email}:`, sendError);
          campaign.recipientMetrics.push({
            email: user.email,
            status: "failed",
            sentAt: new Date(),
          });
          campaign.metrics.bounced++;
        }
      }

      campaign.status = "completed";
      campaign.sentAt = new Date();
      campaign.completedAt = new Date();
      await campaign.save();

      return res.json({
        success: true,
        message: `Campaign sent to ${campaign.metrics.delivered} recipients`,
        data: campaign,
      });
    } catch (sendError) {
      campaign.status = "failed";
      campaign.lastError = sendError.message;
      await campaign.save();

      throw sendError;
    }
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

    campaign.status = "scheduled";
    campaign.schedule = {
      sendAt: new Date(sendAt),
      timezone: "UTC",
    };
    campaign.triggerType = "schedule";

    await campaign.save();

    // TODO: Queue job with Bull/job queue to send at scheduled time

    return res.json({
      success: true,
      message: `Campaign scheduled for ${sendAt}`,
      data: campaign,
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
};
