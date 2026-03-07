import Bull from "bull";
import Campaign from "../models/campaign.model.js";
import { getSegmentedUsers } from "../utils/segmentationEngine.js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Build Redis config with optional password support
const redisConfig = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
};
if (process.env.REDIS_PASSWORD) {
  redisConfig.password = process.env.REDIS_PASSWORD;
}

// Create queue instance (connects to Redis)
const campaignQueue = new Bull("campaigns", {
  redis: redisConfig,
});

// Event-triggered campaigns queue (for enrollment, referral, etc.)
const eventQueue = new Bull("campaign-events", {
  redis: redisConfig,
});

/**
 * Process scheduled campaign sends
 * This runs automatically at scheduled times
 */
campaignQueue.process(async (job) => {
  const { campaignId } = job.data;

  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    if (campaign.status !== "scheduled" && campaign.status !== "running") {
      throw new Error(`Campaign status is ${campaign.status}, skipping send`);
    }

    console.log(`[Campaign Queue] Sending campaign: ${campaign.name}`);

    // Get segmented users
    const { users } = await getSegmentedUsers(campaign.segments, {
      limit: 50000,
    });

    if (users.length === 0) {
      console.log(`[Campaign Queue] No users matched for campaign ${campaignId}`);
      campaign.status = "completed";
      await campaign.save();
      return { sent: 0 };
    }

    campaign.status = "running";
    campaign.metrics.totalSent = users.length;
    campaign.sentAt = new Date();

    let sentCount = 0;
    let failedCount = 0;

    // Send emails in batches to avoid overwhelming Resend
    const batchSize = 100;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (user) => {
          try {
            // Select variant if A/B testing
            let emailSubject = campaign.subject;
            let emailContent = campaign.htmlContent;
            let variantName = "default";

            if (campaign.variants && campaign.variants.length > 0) {
              const randomVariant =
                campaign.variants[
                Math.floor(Math.random() * campaign.variants.length)
                ];
              emailSubject = randomVariant.subject || campaign.subject;
              emailContent = randomVariant.htmlContent || campaign.htmlContent;
              variantName = randomVariant.name || "variant";
            }

            // Send via Resend
            const response = await resend.emails.send({
              from: `${campaign.fromName} <${campaign.fromEmail}>`,
              to: user.email,
              subject: emailSubject,
              html: emailContent,
              headers: {
                "X-Campaign-ID": campaign._id.toString(),
                "X-User-ID": user._id?.toString() || user.email,
              },
            });

            campaign.recipientMetrics.push({
              userId: user._id,
              email: user.email,
              status: "sent",
              sentAt: new Date(),
              variant: variantName,
            });

            campaign.metrics.delivered++;
            sentCount++;
          } catch (sendError) {
            console.error(
              `[Campaign Queue] Failed to send to ${user.email}:`,
              sendError
            );
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

    console.log(
      `[Campaign Queue] Campaign ${campaign.name} completed: ${sentCount} sent, ${failedCount} failed`
    );

    return {
      sent: sentCount,
      failed: failedCount,
      campaignId,
    };
  } catch (error) {
    console.error("[Campaign Queue] Error processing campaign:", error);
    throw error;
  }
});

/**
 * Process event-triggered campaigns
 * Example: enrollment_complete -> send welcome email
 */
eventQueue.process(async (job) => {
  const { eventType, userEmail, userData, campaignId } = job.data;

  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    console.log(
      `[Event Queue] Processing ${eventType} trigger for ${userEmail}`
    );

    // Send email
    const response = await resend.emails.send({
      from: `${campaign.fromName} <${campaign.fromEmail}>`,
      to: userEmail,
      subject: campaign.subject,
      html: campaign.htmlContent,
      headers: {
        "X-Campaign-ID": campaign._id.toString(),
        "X-Event-Type": eventType,
        "X-User-Email": userEmail,
      },
    });

    campaign.recipientMetrics.push({
      email: userEmail,
      status: "sent",
      sentAt: new Date(),
      variant: "event-triggered",
    });

    campaign.metrics.totalSent++;
    campaign.metrics.delivered++;

    await campaign.save();

    console.log(`[Event Queue] Email sent to ${userEmail} for event ${eventType}`);

    return { sent: true, email: userEmail, eventType };
  } catch (error) {
    console.error("[Event Queue] Error processing event:", error);
    throw error;
  }
});

/**
 * Handle completed jobs
 */
campaignQueue.on("completed", (job) => {
  console.log(`[Campaign Queue] Job ${job.id} completed:`, job.data);
});

campaignQueue.on("failed", (job, err) => {
  console.error(`[Campaign Queue] Job ${job.id} failed:`, err.message);
});

eventQueue.on("completed", (job) => {
  console.log(`[Event Queue] Job ${job.id} completed:`, job.data);
});

eventQueue.on("failed", (job, err) => {
  console.error(`[Event Queue] Job ${job.id} failed:`, err.message);
});

/**
 * Schedule a campaign send
 * @param {String} campaignId - Campaign MongoDB ID
 * @param {Date} sendAt - When to send
 */
export const scheduleCampaignJob = async (campaignId, sendAt) => {
  try {
    const delayMs = new Date(sendAt).getTime() - Date.now();

    if (delayMs <= 0) {
      console.warn(
        "[Queue] Send time is in the past, adding to queue immediately"
      );
    }

    const job = await campaignQueue.add(
      { campaignId },
      {
        delay: Math.max(0, delayMs),
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      }
    );

    console.log(`[Queue] Campaign ${campaignId} scheduled for ${sendAt}`);
    return job;
  } catch (error) {
    console.error("[Queue] Error scheduling campaign:", error);
    throw error;
  }
};

/**
 * Queue event-triggered campaign send
 * @param {String} eventType - Event name (enrollment_complete, referral_made, etc.)
 * @param {String} userEmail - Recipient email
 * @param {Object} userData - User data
 * @param {String} campaignId - Campaign to send
 * @param {Number} delayMinutes - Minutes to wait before sending
 */
export const queueEventTriggeredCampaign = async (
  eventType,
  userEmail,
  userData,
  campaignId,
  delayMinutes = 0
) => {
  try {
    const delayMs = delayMinutes * 60 * 1000;

    const job = await eventQueue.add(
      { eventType, userEmail, userData, campaignId },
      {
        delay: delayMs,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      }
    );

    console.log(
      `[Queue] Event ${eventType} queued for ${userEmail} (delay: ${delayMinutes}m)`
    );
    return job;
  } catch (error) {
    console.error("[Queue] Error queuing event campaign:", error);
    throw error;
  }
};

/**
 * Get queue stats
 */
export const getQueueStats = async () => {
  try {
    const campaignCounts = await campaignQueue.getJobCounts();
    const eventCounts = await eventQueue.getJobCounts();

    return {
      campaigns: campaignCounts,
      events: eventCounts,
    };
  } catch (error) {
    console.error("[Queue] Error getting stats:", error);
    return null;
  }
};

/**
 * Clear all queues (use with caution!)
 */
export const clearQueues = async () => {
  try {
    await campaignQueue.empty();
    await eventQueue.empty();
    console.log("[Queue] All queues cleared");
  } catch (error) {
    console.error("[Queue] Error clearing queues:", error);
  }
};

export { campaignQueue, eventQueue };
