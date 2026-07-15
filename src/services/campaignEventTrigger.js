import { EventEmitter } from "events";
import Campaign from "../models/campaign.model.js";
import DripSequence from "../models/dripSequence.model.js";
import { queueEventTriggeredCampaign, queueDripEmail } from "./campaignQueue.js";

// Create global event emitter
const campaignEventEmitter = new EventEmitter();

// Event types that can trigger campaigns
export const CAMPAIGN_EVENTS = {
  ENROLLMENT_COMPLETE: "enrollment_complete",
  REFERRAL_MADE: "referral_made",
  PAYMENT_RECEIVED: "payment_received",
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

    console.log(`[Events] Queued ${campaigns.length} campaigns for enrollment completion`);
    await queueDripSequences(CAMPAIGN_EVENTS.ENROLLMENT_COMPLETE, userData);
  } catch (error) {
    console.error("[Events] Error handling enrollment_complete:", error.message);
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
    await queueDripSequences(CAMPAIGN_EVENTS.REFERRAL_MADE, userData);
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
    await queueDripSequences(CAMPAIGN_EVENTS.PAYMENT_RECEIVED, userData);
  } catch (error) {
    console.error("[Events] Error handling payment_received:", error.message);
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

    console.log(`[Events] Queued ${campaigns.length} campaigns for abandoned enrollment`);
    await queueDripSequences(CAMPAIGN_EVENTS.ENROLLMENT_ABANDONED, userData);
  } catch (error) {
    console.error("[Events] Error handling enrollment_abandoned:", error.message);
  }
}

/**
 * Queue all steps of active drip sequences for a given trigger event
 */
async function queueDripSequences(eventType, userData) {
  try {
    const sequences = await DripSequence.find({ triggerEvent: eventType, status: "active" });
    if (sequences.length === 0) return;

    for (const seq of sequences) {
      let cumulativeDelayMinutes = 0;
      for (const step of seq.steps) {
        cumulativeDelayMinutes += step.delayDays * 24 * 60 + step.delayHours * 60;
        await queueDripEmail(
          userData.email,
          { ...step.toObject(), fromName: seq.fromName, fromEmail: seq.fromEmail },
          seq._id.toString(),
          cumulativeDelayMinutes
        );
      }
      console.log(`[Events] Queued ${seq.steps.length} drip steps for "${seq.name}" → ${userData.email}`);
    }
  } catch (error) {
    console.error("[Events] Error queuing drip sequences:", error.message);
  }
}

export { campaignEventEmitter };
