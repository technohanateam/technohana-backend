import { callClaude } from "../../aiAgent.service.js";
import { stripUnsafe, extractFirstJsonObject } from "./shared.js";

// STEP 5 — 2 A/B subject-line variants, angled differently from the primary
// subject (same cap-at-2 / 50-50 weight the original single-shot agent used).
export async function runVariantsStep({ subject, brief }) {
  const prompt = `Primary subject line already chosen: "${subject}"
Brief: ${brief}

Generate 2 alternate subject lines for A/B testing, each with a slightly different angle from the primary.
Under 60 characters each. Never include prices, coupon codes, or URLs.

Respond ONLY with JSON: {"variants": ["Variant A subject", "Variant B subject"]}`;

  const { text } = await callClaude({
    system: "You are a professional B2B email copywriter. Respond only with valid JSON.",
    prompt,
    maxTokens: 250,
    tier: "cheap",
  });

  const parsed = extractFirstJsonObject(text);
  const variants = (parsed?.variants || []).map(stripUnsafe).slice(0, 2);
  return { variants };
}
