import { callClaude } from "../../aiAgent.service.js";
import { stripUnsafe, extractFirstJsonObject } from "./shared.js";

// STEP 4 — closing call-to-action paragraph, appended to the BODY step's HTML.
// No real link is inserted here (never emit URLs); the CTA is copy-only,
// matching the existing static templates which add the actual button/link shell.
export async function runCtaStep({ htmlContent, brief }) {
  const prompt = `Email body so far:
${htmlContent}

Brief: ${brief}

Write ONE short closing call-to-action paragraph (1-2 sentences) that fits naturally after the body above.
Use only <p> and <strong> tags. Never include prices, coupon codes, or URLs — the actual button/link is added separately by the email template.

Respond ONLY with JSON: {"ctaHtml": "<p>...</p>"}`;

  const { text } = await callClaude({
    system: "You are a professional B2B email copywriter. Respond only with valid JSON.",
    prompt,
    maxTokens: 200,
    tier: "cheap",
  });

  const parsed = extractFirstJsonObject(text);
  if (!parsed?.ctaHtml) throw new Error("CTA step: AI returned no ctaHtml");
  const ctaHtml = stripUnsafe(parsed.ctaHtml);
  return { htmlContent: `${htmlContent}${ctaHtml}` };
}
