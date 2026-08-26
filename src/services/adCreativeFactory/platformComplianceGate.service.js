import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildBrandVoiceEvalPrompt } from "../../prompts/adCreativeFactory/brandVoiceEval.prompt.js";

export { buildBrandVoiceEvalPrompt };

const FIELD_BY_ARRAY = { headlines: "headline", primaryTexts: "primaryText", descriptions: "description" };

// Deterministic, no AI call — annotates every variant with charCount and
// withinLimit against settings.platformLengthLimits. Mutates and returns a
// new creativeDraft object; never throws.
export function applyPlatformFit(creativeDraft, settings) {
  const limits = settings?.platformLengthLimits || {};
  const oversized = [];

  const annotate = (arrayKey) => (variant) => {
    const limitField = FIELD_BY_ARRAY[arrayKey];
    const platformLimits = limits[String(variant.platform || "").toLowerCase()] || {};
    const max = platformLimits[limitField];
    const charCount = variant.text.length;
    const withinLimit = !Number.isFinite(max) || charCount <= max;
    if (!withinLimit) oversized.push({ field: arrayKey, platform: variant.platform, charCount, max });
    return { ...variant, charCount, withinLimit };
  };

  const result = {
    headlines: (creativeDraft.headlines || []).map(annotate("headlines")),
    primaryTexts: (creativeDraft.primaryTexts || []).map(annotate("primaryTexts")),
    descriptions: (creativeDraft.descriptions || []).map(annotate("descriptions")),
    ctas: creativeDraft.ctas || [],
  };

  return { creativeDraft: result, oversized };
}

// Deterministic, no AI call — scans every variant's text for blocklisted
// claim phrases (case-insensitive substring match).
export function scanComplianceBlocklist(creativeDraft, settings) {
  const blocklist = (settings?.complianceKeywordBlocklist || []).map((k) => k.toLowerCase());
  if (!blocklist.length) return [];

  const allTexts = [
    ...(creativeDraft.headlines || []),
    ...(creativeDraft.primaryTexts || []),
    ...(creativeDraft.descriptions || []),
    ...(creativeDraft.ctas || []),
  ].map((v) => v.text);

  const flagged = new Set();
  for (const text of allTexts) {
    const lower = String(text || "").toLowerCase();
    for (const phrase of blocklist) {
      if (lower.includes(phrase)) flagged.add(phrase);
    }
  }
  return [...flagged];
}

// Parses the optional, skippable manual-paste brand-voice response.
export function parseBrandVoiceResponse(text) {
  let parsed;
  try {
    parsed = parseModelJson(text);
  } catch (err) {
    throw new Error(`Failed to parse brand voice evaluator response: ${err.message}`);
  }
  const brandVoiceRiskScore = Math.max(0, Math.min(100, Number(parsed.brandVoiceRiskScore) || 0));
  const flagReasons = Array.isArray(parsed.flagReasons) ? parsed.flagReasons.filter(Boolean) : [];
  return { brandVoiceRiskScore, flagReasons };
}

// PURE — no DB/network. Combines the deterministic blocklist scan with an
// optional brand-voice score (null if the admin skipped that check) into a
// single flaggedForRevision/flagReasons verdict. Unit-testable with plain objects.
export function computeAdComplianceGateResult({ blocklistHits, oversized, brandVoiceResult }, settings) {
  const brandVoiceRiskThreshold = Number.isFinite(settings?.brandVoiceRiskThreshold) ? settings.brandVoiceRiskThreshold : 30;

  const flagReasons = [];
  if (blocklistHits.length) {
    flagReasons.push(`Contains blocklisted claim phrase(s): ${blocklistHits.join(", ")}.`);
  }
  if (oversized.length) {
    flagReasons.push(`${oversized.length} variant(s) exceed the platform character limit.`);
  }
  if (brandVoiceResult && brandVoiceResult.brandVoiceRiskScore > brandVoiceRiskThreshold) {
    flagReasons.push(`Brand-voice risk score (${brandVoiceResult.brandVoiceRiskScore}) exceeds the threshold of ${brandVoiceRiskThreshold}.`);
  }
  if (brandVoiceResult?.flagReasons?.length) {
    for (const reason of brandVoiceResult.flagReasons) {
      if (reason) flagReasons.push(reason);
    }
  }

  const flaggedForRevision = flagReasons.length > 0;
  const overallScore = flaggedForRevision ? Math.max(0, 100 - flagReasons.length * 20) : 100;

  return { overallScore, flaggedForRevision, flagReasons };
}
