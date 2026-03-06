import { EventEmitter } from "events";
import Campaign from "../models/campaign.model.js";
import { queueEventTriggeredCampaign } from "./campaignQueue.js";

// Create global event emitter
const campaignEventEmitter = new EventEmitter();

// Event types that can trigger campaigns
export const CAMPAIGN_EVENTS = {
  ENROLLMENT_COMPLETE: "enrollment_complete",
  REFERRAL_MADE: "referral_made",
  PAYMENT_RECEIVED: "payment_received",
  USER_INACTIVE: "user_inactive",
  ENROLLMENT_ABANDONED: "enrollment_abandoned",
};

/**
 * Register event listeners for campaign triggers
 * Call this in server initialization
 */
export const registerCampaignEventListeners = async () => {
  console.log("[Events] Registering campaign event listeners...");

  // Listen for enrollment completions
  campaignEventEmitter.on(
    CAMPAIGN_EVENTS.ENROLLMENT_COMPLETE,
    async (userData) => {
      await handleEnrollmentComplete(userData);
    }
  );

  // Listen for referrals made
  campaignEventEmitter.on(CAMPAIGN_EVENTS.REFERRAL_MADE, async (userData) => {
    await handleReferralMade(userData);
  });

  // Listen for payments received
  campaignEventEmitter.on(
    CAMPAIGN_EVENTS.PAYMENT_RECEIVED,
    async (userData) => {
      await handlePaymentReceived(userData);
    }
  );

  // Listen for inactive users
  campaignEventEmitter.on(CAMPAIGN_EVENTS.USER_INACTIVE, async (userData) => {
    await handleUserInactive(userData);
  });

  // Listen for abandoned enrollments
  campaignEventEmitter.on(
    CAMPAIGN_EVENTS.ENROLLMENT_ABANDONED,
    async (userData) => {
      await handleEnrollmentAbandoned(userData);
    }
  );

  console.log("[Events] Campaign event listeners registered");
};

/**
 * Emit an event that may trigger campaigns
 */
export const emitCampaignEvent = (eventType, userData) => {
  console.log(`[Events] Emitting event: ${eventType} for ${userData.email}`);
  campaignEventEmitter.emit(eventType, userData);
};

/**
 * Handle enrollment completion
 * Finds and queues campaigns with event trigger: "enrollment_complete"
 */
async function handleEnrollmentComplete(userData) {
  try {
    console.log(
      `[Events] Processing enrollment_complete for ${userData.email}`
    );

    // Find campaigns triggered by enrollment
    const campaigns = await Campaign.find({
      "eventTrigger.event": CAMPAIGN_EVENTS.ENROLLMENT_COMPLETE,
      status: { $ne: "deleted" },
      isPaused: false,
    });

    if (campaigns.length === 0) {
      console.log("[Events] No campaigns trigger on enrollment_complete");
      return;
    }

    // Queue email for each campaign
    for (const campaign of campaigns) {
      const delayMinutes = campaign.eventTrigger?.delayMinutes || 0;
      await queueEventTriggeredCampaign(
        CAMPAIGN_EVENTS.ENROLLMENT_COMPLETE,
        userData.email,
        userData,
        campaign._id.toString(),
        delayMinutes
      );
    }

    console.log(
      `[Events] Queued ${campaigns.length} campaigns for enrollment completion`
    );
  } catch (error) {
    console.error(
      "[Events] Error handling enrollment_complete:",
      error.message
    );
  }
}

/**
 * Handle referral made
 */
async function handleReferralMade(userData) {
  try {
    console.log(`[Events] Processing referral_made for ${userData.email}`);

    const campaigns = await Campaign.find({
      "eventTrigger.event": CAMPAIGN_EVENTS.REFERRAL_MADE,
      status: { $ne: "deleted" },
      isPaused: false,
    });

    for (const campaign of campaigns) {
      const delayMinutes = campaign.eventTrigger?.delayMinutes || 0;
      await queueEventTriggeredCampaign(
        CAMPAIGN_EVENTS.REFERRAL_MADE,
        userData.email,
        userData,
        campaign._id.toString(),
        delayMinutes
      );
    }

    console.log(`[Events] Queued ${campaigns.length} campaigns for referral`);
  } catch (error) {
    console.error("[Events] Error handling referral_made:", error.message);
  }
}

/**
 * Handle payment received
 */
async function handlePaymentReceived(userData) {
  try {
    console.log(
      `[Events] Processing payment_received for ${userData.email}`
    );

    const campaigns = await Campaign.find({
      "eventTrigger.event": CAMPAIGN_EVENTS.PAYMENT_RECEIVED,
      status: { $ne: "deleted" },
      isPaused: false,
    });

    for (const campaign of campaigns) {
      const delayMinutes = campaign.eventTrigger?.delayMinutes || 0;
      await queueEventTriggeredCampaign(
        CAMPAIGN_EVENTS.PAYMENT_RECEIVED,
        userData.email,
        userData,
        campaign._id.toString(),
        delayMinutes
      );
    }

    console.log(`[Events] Queued ${campaigns.length} campaigns for payment`);
  } catch (error) {
    console.error("[Events] Error handling payment_received:", error.message);
  }
}

/**
 * Handle inactive user
 */
async function handleUserInactive(userData) {
  try {
    console.log(
      `[Events] Processing user_inactive for ${userData.email}`
    );

    const campaigns = await Campaign.find({
      "eventTrigger.event": CAMPAIGN_EVENTS.USER_INACTIVE,
      status: { $ne: "deleted" },
      isPaused: false,
    });

    for (const campaign of campaigns) {
      const delayMinutes = campaign.eventTrigger?.delayMinutes || 0;
      await queueEventTriggeredCampaign(
        CAMPAIGN_EVENTS.USER_INACTIVE,
        userData.email,
        userData,
        campaign._id.toString(),
        delayMinutes
      );
    }

    console.log(
      `[Events] Queued ${campaigns.length} campaigns for inactive user`
    );
  } catch (error) {
    console.error("[Events] Error handling user_inactive:", error.message);
  }
}

/**
 * Handle abandoned enrollment
 */
async function handleEnrollmentAbandoned(userData) {
  try {
    console.log(
      `[Events] Processing enrollment_abandoned for ${userData.email}`
    );

    const campaigns = await Campaign.find({
      "eventTrigger.event": CAMPAIGN_EVENTS.ENROLLMENT_ABANDONED,
      status: { $ne: "deleted" },
      isPaused: false,
    });

    for (const campaign of campaigns) {
      const delayMinutes = campaign.eventTrigger?.delayMinutes || 0;
      await queueEventTriggeredCampaign(
        CAMPAIGN_EVENTS.ENROLLMENT_ABANDONED,
        userData.email,
        userData,
        campaign._id.toString(),
        delayMinutes
      );
    }

    console.log(
      `[Events] Queued ${campaigns.length} campaigns for abandoned enrollment`
    );
  } catch (error) {
    console.error(
      "[Events] Error handling enrollment_abandoned:",
      error.message
    );
  }
}

export { campaignEventEmitter };
