import { callClaude } from "../../aiAgent.service.js";
import { stripUnsafe, extractFirstJsonObject } from "./shared.js";

// STEP 1 — subject line. Kept separate from BODY so a rejected subject can be
// regenerated (via retryFromStep) without re-writing the whole email.
export async function runSubjectStep({ campaignName, brief }) {
  const prompt = `You are a B2B email marketer for TechnoHana, an AI Training & Corporate Learning company.
Write ONE email subject line for this campaign.

Campaign name: ${campaignName}
Brief: ${brief}

Rules:
- Under 60 characters
- Action-oriented, no clickbait
- Never include prices, coupon codes, or URLs

Respond ONLY with JSON: {"subject": "..."}`;

  const { text } = await callClaude({
    system: "You are a professional B2B email copywriter. Respond only with valid JSON.",
    prompt,
    maxTokens: 200,
    tier: "cheap",
  });

  const parsed = extractFirstJsonObject(text);
  if (!parsed?.subject) throw new Error("SUBJECT step: AI returned no subject");
  return { subject: stripUnsafe(parsed.subject).slice(0, 150) };
}
