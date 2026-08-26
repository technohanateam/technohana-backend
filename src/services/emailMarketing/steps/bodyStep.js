import { callClaude } from "../../aiAgent.service.js";
import { stripUnsafe, extractFirstJsonObject } from "./shared.js";

// STEP 3 — main HTML body, written to lead into the CTA step rather than
// including its own call-to-action paragraph.
export async function runBodyStep({ campaignName, subject, brief }) {
  const prompt = `You are a B2B email marketer for TechnoHana, an AI Training & Corporate Learning company.

Campaign name: ${campaignName}
Subject line (already chosen): ${subject}
Brief: ${brief}

Write the main body of the email. Tone: professional yet approachable.
Structured HTML using only <h2>, <p>, <ul>, <li>, <strong>, <br> tags. Under 250 words.
Do NOT write a closing call-to-action paragraph — that is added separately.
Never include specific prices, coupon codes, or external URLs.

Respond ONLY with JSON: {"htmlContent": "<h2>...</h2><p>...</p>"}`;

  const { text } = await callClaude({
    system: "You are a professional B2B email copywriter. Respond only with valid JSON.",
    prompt,
    maxTokens: 700,
  });

  const parsed = extractFirstJsonObject(text);
  if (!parsed?.htmlContent) throw new Error("BODY step: AI returned no htmlContent");
  return { htmlContent: stripUnsafe(parsed.htmlContent) };
}
