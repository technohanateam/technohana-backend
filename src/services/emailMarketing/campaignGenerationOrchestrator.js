import { generateCampaignCopy } from "../campaignCopywriterAgent.js";
import { runCampaignQualityGate } from "./campaignQualityGate.js";

// STEP_ORDER mirrors the blog Content Factory's generation pipeline
// (BRIEF -> ARTICLE -> ... -> QUALITY_GATE): a brief goes in, copy comes
// out gated behind an automated compliance/style check before a human
// ever needs to look at it. campaign.copyGeneration.step tracks progress
// so an admin can see where a generation run is/was.
export const STEP_ORDER = ["GENERATE", "COMPLIANCE_CHECK", "DONE"];

// Runs the full brief -> copy -> quality-gate pipeline for one campaign.
// Returns the quality gate result; the campaign doc is updated in place at
// each step so a failed run leaves useful state behind instead of nothing.
export async function generateAndGateCampaignCopy(campaignId, brief) {
  await generateCampaignCopy(campaignId, brief);
  return runCampaignQualityGate(campaignId);
}
