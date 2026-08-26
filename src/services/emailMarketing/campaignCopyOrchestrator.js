import Campaign from "../../models/campaign.model.js";
import { runSubjectStep } from "./steps/subjectStep.js";
import { runPreviewStep } from "./steps/previewStep.js";
import { runBodyStep } from "./steps/bodyStep.js";
import { runCtaStep } from "./steps/ctaStep.js";
import { runVariantsStep } from "./steps/variantsStep.js";
import { runCampaignQualityGate } from "./campaignQualityGate.js";
import { reviseCampaignCopy } from "./campaignRevisionAgent.js";

// Step-orchestrated replacement for the old single-shot
// campaignCopywriterAgent.generateCampaignCopy() — analog of
// contentFactory/contentGenerationOrchestrator.service.js's STEP_ORDER
// pattern, minus pause/resume (every step here calls the API directly, no
// manual-paste mode, so there's nothing to pause for).
const STEP_ORDER = ["SUBJECT", "PREVIEW", "BODY", "CTA", "VARIANTS", "COMPLIANCE_CHECK"];

function initSteps() {
  return STEP_ORDER.map((name) => ({ name, status: "PENDING" }));
}

async function markStep(campaign, name, status, error = null) {
  const step = campaign.copySteps.find((s) => s.name === name);
  step.status = status;
  step.error = error;
  if (status === "DONE" || status === "FAILED") step.finishedAt = new Date();
  await campaign.save();
}

// Runs the full pipeline for a campaign, given a plain-language brief.
// Writes intermediate results onto the Campaign doc after every step so
// partial progress is never lost if a later step throws. Never throws —
// returns a result object; failures leave copySteps showing exactly which
// step failed and why.
export async function generateCampaignCopy(campaignId, brief) {
  if (!brief || typeof brief !== "string" || brief.trim().length < 10) {
    throw new Error("Brief must be at least 10 characters");
  }

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const trimmedBrief = brief.trim();
  campaign.copyBrief = trimmedBrief;
  campaign.copySteps = initSteps();
  campaign.reviewState = "PENDING_REVIEW";
  campaign.reviewFlagReasons = [];
  campaign.autoRevisionCount = 0;
  await campaign.save();

  let subject, previewText, htmlContent, variants;

  try {
    await markStep(campaign, "SUBJECT", "RUNNING");
    ({ subject } = await runSubjectStep({ campaignName: campaign.name, brief: trimmedBrief }));
    await markStep(campaign, "SUBJECT", "DONE");

    await markStep(campaign, "PREVIEW", "RUNNING");
    ({ previewText } = await runPreviewStep({ subject, brief: trimmedBrief }));
    await markStep(campaign, "PREVIEW", "DONE");

    await markStep(campaign, "BODY", "RUNNING");
    ({ htmlContent } = await runBodyStep({ campaignName: campaign.name, subject, brief: trimmedBrief }));
    await markStep(campaign, "BODY", "DONE");

    await markStep(campaign, "CTA", "RUNNING");
    ({ htmlContent } = await runCtaStep({ htmlContent, brief: trimmedBrief }));
    await markStep(campaign, "CTA", "DONE");

    await markStep(campaign, "VARIANTS", "RUNNING");
    ({ variants } = await runVariantsStep({ subject, brief: trimmedBrief }));
    await markStep(campaign, "VARIANTS", "DONE");
  } catch (err) {
    const failedStep = campaign.copySteps.find((s) => s.status === "RUNNING");
    if (failedStep) await markStep(campaign, failedStep.name, "FAILED", err.message);
    campaign.reviewState = "NEEDS_REVISION";
    campaign.reviewFlagReasons = [`Generation failed at step ${failedStep?.name || "UNKNOWN"}: ${err.message}`];
    await campaign.save();
    return { success: false, campaign };
  }

  campaign.subject = subject;
  campaign.previewText = previewText;
  campaign.htmlContent = htmlContent;
  campaign.variants = variants.map((s, i) => ({
    name: `Variant ${String.fromCharCode(65 + i)}`,
    subject: s,
    htmlContent,
    weight: 50,
  }));
  await campaign.save();

  return runComplianceCheckStep(campaign);
}

// COMPLIANCE_CHECK step — runs the quality gate; on a flagged draft, runs
// exactly one automatic revision pass (mirrors the blog factory's
// autoRevisionCount === 0 guard), then re-gates once more before deciding.
async function runComplianceCheckStep(campaign) {
  await markStep(campaign, "COMPLIANCE_CHECK", "RUNNING");

  let gateResult = await runCampaignQualityGate(campaign);

  if (!gateResult.passed && (campaign.autoRevisionCount || 0) === 0) {
    try {
      const revised = await reviseCampaignCopy({
        subject: campaign.subject,
        htmlContent: campaign.htmlContent,
        flagReasons: gateResult.flagReasons,
      });
      campaign.subject = revised.subject;
      campaign.htmlContent = revised.htmlContent;
      campaign.variants = campaign.variants.map((v) => ({ ...v.toObject?.() ?? v, htmlContent: revised.htmlContent }));
      campaign.autoRevisionCount = 1;
      await campaign.save();

      gateResult = await runCampaignQualityGate(campaign);
    } catch (err) {
      console.error(`[campaignCopyOrchestrator] revision pass failed for campaign ${campaign._id}:`, err.message);
      // Fall through with the original (pre-revision) gateResult — still
      // routes to NEEDS_REVISION below, just without a rewritten draft.
    }
  }

  if (gateResult.passed) {
    await markStep(campaign, "COMPLIANCE_CHECK", "DONE");
    campaign.reviewState = "APPROVED";
    campaign.reviewFlagReasons = [];
  } else {
    await markStep(campaign, "COMPLIANCE_CHECK", "DONE");
    campaign.reviewState = "NEEDS_REVISION";
    campaign.reviewFlagReasons = gateResult.flagReasons;
  }
  await campaign.save();

  return { success: true, campaign, reviewState: campaign.reviewState, flagReasons: campaign.reviewFlagReasons };
}

// Re-runs only the COMPLIANCE_CHECK step — used by the human-review "retry
// gate" action after a human hand-edits flagged copy, without regenerating
// the whole email.
export async function rerunComplianceCheck(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  if (!campaign.copySteps?.length) campaign.copySteps = initSteps();
  return runComplianceCheckStep(campaign);
}
