import Campaign from "../models/campaign.model.js";
import { Blogs } from "../models/blogs.model.js";
import { Resend } from "resend";
import { getSegmentedUsers } from "../utils/segmentationEngine.js";
import { scheduleCampaignJob, getQueueStats } from "../services/campaignQueue.js";
import { buildRegexQuery } from "../utils/escapeRegex.js";
import { personalizeForRecipient } from "../services/emailMarketing/campaignPersonalizer.js";
import { generateBlogPostEmail } from "../utils/emailTemplate.js";

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

// Create a draft campaign pre-filled from a published blog post
export const createCampaignFromBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blogs.findById(id);
    if (!blog) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }
    if (!blog.published) {
      return res.status(400).json({ success: false, message: "Only published posts can be emailed" });
    }

    const campaign = new Campaign({
      name: `Blog: ${blog.title}`,
      subject: blog.title,
      htmlContent: generateBlogPostEmail({
        title: blog.title,
        excerpt: blog.excerpt,
        img: blog.img,
        slug: blog.slug,
      }),
      previewText: blog.excerpt,
      segments: {
        enrolledUsers: true,
        customFilters: [{ field: "type", operator: "in", value: ["subscriber"] }],
      },
      triggerType: "manual",
      createdBy: req.admin?._id,
      createdByRole: req.admin?.role,
      status: "draft",
    });

    await campaign.save();

    return res.status(201).json({
      success: true,
      message: "Campaign created from blog post",
      data: campaign,
    });
  } catch (error) {
    console.error("Error creating campaign from blog:", error);
    return res.status(500).json({ success: false, message: "Error creating campaign from blog" });
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

    if (campaign.reviewState === "PENDING_REVIEW" || campaign.reviewState === "NEEDS_REVISION") {
      return res.status(400).json({
        success: false,
        message: `Campaign copy has not cleared review (reviewState: ${campaign.reviewState}). Approve it first.`,
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
            let emailSubject = campaign.subject;
            let emailContent = campaign.htmlContent;
            if (campaign.personalize) {
              const personalized = await personalizeForRecipient({
                subject: emailSubject,
                htmlContent: emailContent,
                recipient: user,
              });
              emailSubject = personalized.subject;
              emailContent = personalized.htmlContent;
            }

            const response = await resend.emails.send({
              from: `${campaign.fromName} <${campaign.fromEmail}>`,
              to: user.email,
              subject: emailSubject,
              html: emailContent,
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

    if (campaign.reviewState === "PENDING_REVIEW" || campaign.reviewState === "NEEDS_REVISION") {
      return res.status(400).json({
        success: false,
        message: `Campaign copy has not cleared review (reviewState: ${campaign.reviewState}). Approve it first.`,
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

export const generateAICopy = async (req, res) => {
  try {
    const { brief } = req.body;
    if (!brief || brief.trim().length < 10) {
      return res.status(400).json({ success: false, message: "Brief must be at least 10 characters" });
    }

    const { generateCampaignCopy } = await import("../services/emailMarketing/campaignCopyOrchestrator.js");
    const result = await generateCampaignCopy(req.params.id, brief);
    res.json({
      success: result.success,
      data: result.campaign,
      message: result.success
        ? `AI copy generated — review state: ${result.reviewState}`
        : "AI copy generation failed partway through the pipeline",
    });
  } catch (err) {
    console.error("generateAICopy error:", err);
    res.status(500).json({ success: false, message: "AI copy generation failed" });
  }
};

// Human review — approve a campaign whose AI copy is in PENDING_REVIEW or
// NEEDS_REVISION, allowing it to be scheduled/sent despite outstanding flags
// (an explicit human override of the quality gate).
export const approveCampaignReview = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    campaign.reviewState = "APPROVED";
    campaign.reviewedBy = req.admin?.email || req.admin?._id?.toString() || "admin";
    campaign.reviewedAt = new Date();
    await campaign.save();

    res.json({ success: true, message: "Campaign approved", data: campaign });
  } catch (err) {
    console.error("approveCampaignReview error:", err);
    res.status(500).json({ success: false, message: "Error approving campaign" });
  }
};

// Reject — leaves the campaign in NEEDS_REVISION with a human-supplied reason
// appended, so it cannot be scheduled/sent until edited and re-approved.
export const rejectCampaignReview = async (req, res) => {
  try {
    const { reason } = req.body;
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    campaign.reviewState = "NEEDS_REVISION";
    campaign.reviewFlagReasons = reason ? [...campaign.reviewFlagReasons, reason] : campaign.reviewFlagReasons;
    campaign.reviewedBy = req.admin?.email || req.admin?._id?.toString() || "admin";
    campaign.reviewedAt = new Date();
    await campaign.save();

    res.json({ success: true, message: "Campaign rejected", data: campaign });
  } catch (err) {
    console.error("rejectCampaignReview error:", err);
    res.status(500).json({ success: false, message: "Error rejecting campaign" });
  }
};

// Regenerate — re-runs the full copy pipeline from a (possibly edited) brief.
export const regenerateCampaignCopy = async (req, res) => {
  try {
    const { brief } = req.body;
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    const { generateCampaignCopy } = await import("../services/emailMarketing/campaignCopyOrchestrator.js");
    const result = await generateCampaignCopy(campaign._id, brief || campaign.copyBrief);

    res.json({
      success: result.success,
      data: result.campaign,
      message: result.success ? `Regenerated — review state: ${result.reviewState}` : "Regeneration failed",
    });
  } catch (err) {
    console.error("regenerateCampaignCopy error:", err);
    res.status(500).json({ success: false, message: "Error regenerating campaign copy" });
  }
};

// Re-runs just the automated compliance/style gate (e.g. after a human
// hand-edits flagged copy) without regenerating the whole email.
export const rerunCampaignQualityGate = async (req, res) => {
  try {
    const { rerunComplianceCheck } = await import("../services/emailMarketing/campaignCopyOrchestrator.js");
    const result = await rerunComplianceCheck(req.params.id);
    res.json({ success: true, data: result.campaign, message: `Quality gate re-run — review state: ${result.reviewState}` });
  } catch (err) {
    console.error("rerunCampaignQualityGate error:", err);
    res.status(500).json({ success: false, message: "Error re-running quality gate" });
  }
};

export default {
  getAllCampaigns,
  getCampaign,
  createCampaign,
  createCampaignFromBlog,
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
  approveCampaignReview,
  rejectCampaignReview,
  regenerateCampaignCopy,
  rerunCampaignQualityGate,
};
