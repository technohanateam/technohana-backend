import { callClaude } from "../../aiAgent.service.js";
import { stripUnsafe, extractFirstJsonObject } from "./shared.js";

// STEP 2 — inbox preview text, generated to complement (not repeat) the subject.
export async function runPreviewStep({ subject, brief }) {
  const prompt = `Subject line already chosen: "${subject}"
Brief: ${brief}

Write inbox preview text that complements the subject (doesn't repeat it), under 90 characters.
Never include prices, coupon codes, or URLs.

Respond ONLY with JSON: {"previewText": "..."}`;

  const { text } = await callClaude({
    system: "You are a professional B2B email copywriter. Respond only with valid JSON.",
    prompt,
    maxTokens: 200,
    tier: "cheap",
  });

  const parsed = extractFirstJsonObject(text);
  if (!parsed?.previewText) throw new Error("PREVIEW step: AI returned no previewText");
  return { previewText: stripUnsafe(parsed.previewText).slice(0, 150) };
}
