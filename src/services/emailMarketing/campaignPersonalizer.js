import { callClaude } from "../aiAgent.service.js";
import { stripUnsafe, extractFirstJsonObject } from "./steps/shared.js";

// Per-recipient personalization at send time — generalizes the pattern in
// recoveryEmailAgent.js (which only personalizes abandoned-cart emails) to
// any campaign flagged `personalize: true`. Runs a cheap-tier merge-fill pass
// that lightly adapts the human-approved htmlContent using attributes already
// available on the recipient, rather than regenerating the email from
// scratch — keeps cost/latency bounded and keeps the approved copy as the
// source of truth. Falls back to the static approved content on any failure,
// same discipline as recoveryEmailAgent.js.
const SYSTEM_PROMPT = `You lightly personalize a pre-approved marketing email for one recipient.
Rules:
- Keep the HTML structure and tags exactly as given.
- Only adjust wording to naturally reference the recipient's course/city/status where it fits — do not invent facts not present in the recipient info.
- Do not add, remove, or reorder sections. Do not change length by more than ~15%.
- Never include prices, coupon codes, or URLs.
Respond ONLY with JSON: {"htmlContent": "..."}`;

export async function personalizeForRecipient({ subject, htmlContent, recipient }) {
  try {
    const recipientInfo = {
      name: recipient.name || null,
      courseTitle: recipient.courseTitle || null,
      city: recipient.city || null,
      aiScoreBand: recipient.aiScoreBand || null,
      isReferralPartner: Boolean(recipient.referralCode),
    };

    // Nothing to personalize against — skip the AI call entirely rather than
    // spending a request to produce a no-op rewrite.
    if (!recipientInfo.name && !recipientInfo.courseTitle && !recipientInfo.city) {
      return { subject, htmlContent };
    }

    const prompt = JSON.stringify({ subject, htmlContent, recipient: recipientInfo });
    const { text } = await callClaude({ system: SYSTEM_PROMPT, prompt, maxTokens: 700, tier: "cheap" });
    const parsed = extractFirstJsonObject(text);
    if (!parsed?.htmlContent) return { subject, htmlContent };

    return { subject, htmlContent: stripUnsafe(parsed.htmlContent) };
  } catch (err) {
    console.error(`[campaignPersonalizer] Falling back to static content for ${recipient.email}:`, err.message);
    return { subject, htmlContent };
  }
}
