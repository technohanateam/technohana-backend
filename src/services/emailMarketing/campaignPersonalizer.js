import { callClaude } from "../aiAgent.service.js";

// Per-recipient personalization at scale (generalizes the pattern already
// proven in recoveryEmailAgent.js — per-user AI copy with a hard fallback —
// beyond the single abandoned-cart flow to any campaign that opts in).
//
// Rather than regenerating the whole approved email per recipient (slow,
// costly, and it would bypass the human-approved copy), this fills in a
// single marked block using attributes already available from
// segmentationEngine/User, and falls back to the block being removed
// (never left as raw markup) on any failure.

const PERSONALIZE_MARKER = /<!--\s*PERSONALIZE\s*-->/i;

const SYSTEM_PROMPT = `You write one short, warm sentence (under 25 words) personalizing a marketing email intro for a specific recipient, using only the attributes given. No prices, coupon codes, or links. Output ONLY the sentence as plain text, no quotes.`;

async function generatePersonalizedLine(user) {
  const attrs = {
    courseTitle: user.courseTitle || user.enrollmentFormData?.courseTitle || null,
    city: user.city || null,
    trainingType: user.enrollmentFormData?.trainingType || user.trainingType || null,
    aiScoreBand: user.aiScoreBand || null,
    isReferralPartner: !!(user.referralCode && user.referralCount > 0),
  };
  if (!attrs.courseTitle && !attrs.city && !attrs.trainingType && !attrs.isReferralPartner) return null;

  const { text } = await callClaude({
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify(attrs),
    maxTokens: 100,
    tier: "cheap",
  });
  const line = text.trim().replace(/^["']|["']$/g, "");
  return line.length > 0 && line.length < 300 ? line : null;
}

// Returns HTML with the PERSONALIZE marker filled in for this recipient, or
// the original HTML unchanged if there's no marker, no usable attributes, or
// the AI call fails for any reason — sending never blocks on this.
export async function personalizeHtmlForRecipient(htmlContent, user) {
  if (!htmlContent || !PERSONALIZE_MARKER.test(htmlContent)) return htmlContent;

  try {
    const line = await generatePersonalizedLine(user);
    if (!line) return htmlContent.replace(PERSONALIZE_MARKER, "");
    return htmlContent.replace(PERSONALIZE_MARKER, `<p>${line}</p>`);
  } catch (err) {
    console.error(`[Personalizer] Failed for ${user.email}, sending unpersonalized:`, err.message);
    return htmlContent.replace(PERSONALIZE_MARKER, "");
  }
}
