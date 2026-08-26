import { callClaude, extractJson } from "../aiAgent.service.js";

// Campaign Quality Gate — analog of contentFactory/qualityGate.service.js.
// Runs deterministic compliance checks plus one AI style/genericness check,
// then decides whether a campaign's copy can proceed straight to APPROVED or
// must be routed to NEEDS_REVISION for a human.

const PRICE_PATTERN = /\b(₹|INR|USD|\$|AED|£|€)\s*[\d,]+/i;
const COUPON_PATTERN = /\b[A-Z]{4,}\d{1,2}\b/;
const URL_PATTERN = /https?:\/\/\S+/i;

// Deterministic — no network calls, pure text scan for the guardrails every
// AI copy step is already supposed to have stripped. Catches anything a step
// missed (e.g. a human edit after generation re-introducing a price).
function runComplianceChecks({ subject, previewText, htmlContent, variants }) {
  const reasons = [];
  const haystacks = [subject, previewText, htmlContent, ...(variants || []).map((v) => v.subject)].filter(Boolean);

  for (const text of haystacks) {
    if (PRICE_PATTERN.test(text)) reasons.push("Copy contains a hardcoded price — prices must come from computeQuote(), never be stated in campaign copy.");
    if (COUPON_PATTERN.test(text)) reasons.push("Copy contains what looks like a hardcoded coupon code.");
    if (URL_PATTERN.test(text)) reasons.push("Copy contains a raw URL — links must be added via the email template, not written by the AI.");
  }

  return [...new Set(reasons)];
}

const STYLE_SYSTEM_PROMPT = `You evaluate marketing email copy for how generic/AI-sounding it reads.
Respond ONLY with JSON: {"aiStyleRiskScore": 0-100, "flagReasons": ["..."]}
0 = reads like a specific, human-written email. 100 = generic AI marketing filler ("Unlock your potential", "In today's fast-paced world", etc).`;

async function runAiStyleCheck({ subject, htmlContent }) {
  try {
    const prompt = JSON.stringify({ subject, htmlContent });
    const { text } = await callClaude({ system: STYLE_SYSTEM_PROMPT, prompt, maxTokens: 300, tier: "cheap" });
    const parsed = extractJson(text);
    return {
      aiStyleRiskScore: Math.max(0, Math.min(100, Number(parsed?.aiStyleRiskScore) || 0)),
      flagReasons: Array.isArray(parsed?.flagReasons) ? parsed.flagReasons : [],
    };
  } catch (err) {
    // Never let a style-check failure block the gate outright — treat as
    // "unknown" (0 risk) and let compliance checks + human review catch issues.
    console.error("[campaignQualityGate] AI style check failed:", err.message);
    return { aiStyleRiskScore: 0, flagReasons: [] };
  }
}

const AI_STYLE_RISK_THRESHOLD = 40;

// Returns { passed, flagReasons } — pure decision, no persistence. Callers
// (the step orchestrator) are responsible for writing the result onto the
// Campaign doc's reviewState/reviewFlagReasons.
export async function runCampaignQualityGate(campaign) {
  const complianceReasons = runComplianceChecks({
    subject: campaign.subject,
    previewText: campaign.previewText,
    htmlContent: campaign.htmlContent,
    variants: campaign.variants,
  });

  // Compliance failures are hard blocks — skip the (slower, costed) AI style
  // check if copy already needs a rewrite for a concrete reason.
  if (complianceReasons.length > 0) {
    return { passed: false, flagReasons: complianceReasons };
  }

  const styleResult = await runAiStyleCheck({ subject: campaign.subject, htmlContent: campaign.htmlContent });
  const flagReasons = [...styleResult.flagReasons];
  if (styleResult.aiStyleRiskScore > AI_STYLE_RISK_THRESHOLD) {
    flagReasons.push(`AI-style risk score (${styleResult.aiStyleRiskScore}) exceeds the threshold of ${AI_STYLE_RISK_THRESHOLD}.`);
  }

  return { passed: flagReasons.length === 0, flagReasons };
}
