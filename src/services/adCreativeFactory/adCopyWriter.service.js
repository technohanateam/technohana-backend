import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildAdBriefPrompt } from "../../prompts/adCreativeFactory/adBrief.prompt.js";
import { buildAdCopyDraftPrompt } from "../../prompts/adCreativeFactory/adCopyDraft.prompt.js";
import { callClaude } from "../aiAgent.service.js";
import { getOrCreateAdCreativeFactorySettings } from "../../models/adCreativeFactory/adCreativeFactorySettings.model.js";
import { checkBudget } from "../contentFactory/budgetGuard.service.js";
import { recordAdCreativeAiUsage } from "./adCreativeUsageTracker.service.js";

export { buildAdBriefPrompt, buildAdCopyDraftPrompt };

// Pure transform: AI JSON text -> brief object. No DB, no side effects.
export function parseAdBriefResponse(text) {
  let parsed;
  try {
    parsed = parseModelJson(text);
  } catch (err) {
    throw new Error(`Failed to parse ad brief AI response: ${err.message}`);
  }
  return {
    angle: parsed.angle || null,
    keySellingPoints: Array.isArray(parsed.keySellingPoints) ? parsed.keySellingPoints : [],
    tone: parsed.tone || null,
    targetAudience: parsed.targetAudience || null,
    painPoint: parsed.painPoint || null,
    proofPoint: parsed.proofPoint || null,
  };
}

// Opportunistic direct-API path for the BRIEF step only — mirrors
// generateContentBriefViaApi() in Content Factory. Never the default; the
// orchestrator falls back to manual-paste if this throws. Checks
// AdCreativeFactorySettings' own daily budget before calling (independent of
// Content Factory's budget) and records the resulting spend afterward.
export async function generateAdBriefViaApi({ opportunity, callClaudeFn = callClaude }) {
  const settings = await getOrCreateAdCreativeFactorySettings();
  const { allowed, reason } = checkBudget(settings, 0.01);
  if (!allowed) throw new Error(reason);

  const { system, prompt } = buildAdBriefPrompt(opportunity);
  const { text, usage, model } = await callClaudeFn({ system, prompt, maxTokens: 1024, tier: "standard" });
  const brief = parseAdBriefResponse(text);
  await recordAdCreativeAiUsage({
    model,
    tier: "standard",
    tokensIn: usage?.input_tokens || 0,
    tokensOut: usage?.output_tokens || 0,
    callType: "brief",
    opportunityId: opportunity._id,
  });
  return { brief, model, usage };
}

function normalizeVariants(list, fallbackPlatform) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((v) => v?.text)
    .map((v) => ({ text: String(v.text).trim(), platform: v.platform || fallbackPlatform }));
}

// Pure transform: AI JSON text -> creativeDraft variant arrays (no char-count/
// withinLimit annotation yet — that's PLATFORM_FIT's deterministic job).
export function parseAdCopyDraftResponse(text, opportunity) {
  let parsed;
  try {
    parsed = parseModelJson(text);
  } catch (err) {
    throw new Error(`Failed to parse ad copy draft AI response: ${err.message}`);
  }
  const fallbackPlatform = opportunity.platform === "BOTH" ? "META" : opportunity.platform;
  return {
    headlines: normalizeVariants(parsed.headlines, fallbackPlatform),
    primaryTexts: normalizeVariants(parsed.primaryTexts, fallbackPlatform),
    descriptions: normalizeVariants(parsed.descriptions, fallbackPlatform),
    ctas: normalizeVariants(parsed.ctas, fallbackPlatform),
  };
}
