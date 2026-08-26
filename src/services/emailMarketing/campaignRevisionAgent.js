import { callClaude } from "../aiAgent.service.js";
import { stripUnsafe, extractFirstJsonObject } from "./steps/shared.js";

// One automatic rewrite pass when the quality gate flags a draft — same
// cap-at-1 discipline as contentFactory/revisionAgent.service.js. Rewrites
// subject + body together rather than re-running each step from scratch,
// since the flagged reasons are usually cross-cutting (e.g. AI-style risk).
export async function reviseCampaignCopy({ subject, htmlContent, flagReasons }) {
  const prompt = `The following email copy was flagged by an automatic quality gate for these reasons:
${flagReasons.map((r) => `- ${r}`).join("\n")}

Current subject: ${subject}
Current body HTML: ${htmlContent}

Rewrite the subject and body to fix the flagged issues. Keep the same core message and length constraints (subject under 60 characters, body under 250 words, HTML using only <h2>, <p>, <ul>, <li>, <strong>, <br> tags). Never include prices, coupon codes, or URLs.

Respond ONLY with JSON: {"subject": "...", "htmlContent": "..."}`;

  const { text } = await callClaude({
    system: "You are a professional B2B email copywriter fixing flagged copy. Respond only with valid JSON.",
    prompt,
    maxTokens: 700,
  });

  const parsed = extractFirstJsonObject(text);
  if (!parsed?.subject || !parsed?.htmlContent) throw new Error("Revision: AI returned incomplete copy");

  return {
    subject: stripUnsafe(parsed.subject).slice(0, 150),
    htmlContent: stripUnsafe(parsed.htmlContent),
  };
}
