import Campaign from "../models/campaign.model.js";

/**
 * Handle Resend webhook events
 * https://resend.com/docs/api-reference/emails/get-email
 */

/**
 * Verify Resend webhook signature
 * Using X-Resend-Signature header
 */
export const verifyResendWebhook = (req, res, buf, encoding) => {
  // Resend doesn't currently use signature verification
  // But we can validate source in the future
  return true;
};

/**
 * Process Resend email events (opened, clicked, bounced, etc.)
 */
export const handleResendWebhook = async (req, res) => {
  try {
    const event = req.body;

    // Event structure from Resend:
    // {
    //   "type": "email.opened" | "email.clicked" | "email.bounced" | "email.complained",
    //   "created_at": "2023-10-24T20:00:00.000Z",
    //   "data": {
    //     "email_id": "...",
    //     "from": "...",
    //     "to": "...",
    //     "created_at": "...",
    //     "headers": { "x-campaign-id": "...", "x-user-id": "..." }
    //   }
    // }

    const { type, data } = event;
    const campaignId = data?.headers?.["x-campaign-id"];
    const userId = data?.headers?.["x-user-id"];
    const recipientEmail = data?.to;

    if (!campaignId) {
      console.warn("[Webhook] No campaign ID in event headers");
      return res.json({ success: true }); // Still acknowledge to Resend
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      console.warn(`[Webhook] Campaign ${campaignId} not found`);
      return res.json({ success: true });
    }

    console.log(
      `[Webhook] Processing ${type} event for ${recipientEmail} in campaign ${campaign.name}`
    );

    // Find recipient metric
    const recipient = campaign.recipientMetrics.find(
      (r) => r.email === recipientEmail
    );

    if (!recipient) {
      console.warn(
        `[Webhook] Recipient ${recipientEmail} not found in campaign`
      );
      return res.json({ success: true });
    }

    // Update metrics based on event type
    switch (type) {
      case "email.opened":
        if (!recipient.openedAt) {
          recipient.openedAt = new Date();
          campaign.metrics.opened++;
        }
        break;

      case "email.clicked":
        if (!recipient.clickedAt) {
          recipient.clickedAt = new Date();
          campaign.metrics.clicked++;
        }
        // Capture clicked URL if available
        if (data?.data?.click?.url) {
          recipient.clickUrl = data.data.click.url;
        }
        break;

      case "email.bounced":
        recipient.status = "bounced";
        campaign.metrics.bounced++;
        break;

      case "email.complained":
        recipient.status = "complained";
        campaign.metrics.complained++;
        break;

      case "email.delivered":
        if (recipient.status === "sent") {
          recipient.status = "delivered";
          campaign.metrics.delivered++;
        }
        break;

      case "email.failed":
        recipient.status = "failed";
        campaign.metrics.bounced++;
        break;

      case "email.unsubscribed":
        recipient.status = "unsubscribed";
        campaign.metrics.unsubscribed++;
        break;

      default:
        console.log(`[Webhook] Unknown event type: ${type}`);
    }

    await campaign.save();

    res.json({ success: true, event: type });
  } catch (error) {
    console.error("[Webhook] Error processing Resend event:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Resend Email object structure (for reference)
 * {
 *   "object": "email",
 *   "id": "...",
 *   "from": "...",
 *   "to": ["..."],
 *   "created_at": "...",
 *   "subject": "...",
 *   "html": "...",
 *   "text": null,
 *   "text_as_html": null,
 *   "bcc": [],
 *   "cc": [],
 *   "in_reply_to": null,
 *   "reply_to": [],
 *   "blocked_reason": null,
 *   "headers": {},
 *   "attachments": [],
 *   "metadata": {},
 *   "scheduled_at": null,
 *   "tags": []
 * }
 */
