import Campaign from "../models/campaign.model.js";
import { callClaude } from "./aiAgent.service.js";

// Agent 4 — Campaign Copywriter
// Generates email copy (subject, preview, HTML body, A/B variant subjects)
// from a plain-language brief. Never emits prices, coupon codes, or URLs.

export async function generateCampaignCopy(campaignId, brief) {
  if (!brief || typeof brief !== "string" || brief.trim().length < 10) {
    throw new Error("Brief must be at least 10 characters");
  }

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const prompt = `You are a B2B email marketer for TechnoHana, an AI Training & Corporate Learning company.
Generate professional marketing email copy based on this brief:

Brief: ${brief.trim()}
Campaign name: ${campaign.name}

Rules:
- Never include specific prices, coupon codes, or external URLs
- Tone: professional yet approachable
- Subject line: under 60 characters, action-oriented
- Preview text: under 90 characters
- Body: structured HTML using only <h2>, <p>, <ul>, <li>, <strong>, <br> tags. Under 300 words.
- Generate 2 A/B variant subject lines (slightly different angles)

Respond ONLY with valid JSON:
{
  "subject": "Primary subject line",
  "previewText": "Preview text",
  "htmlContent": "<h2>...</h2><p>...</p>",
  "abVariants": ["Variant A subject", "Variant B subject"]
}`;

  const raw = await callClaude({
    system: "You are a professional B2B email copywriter. Respond only with valid JSON.",
    prompt,
    maxTokens: 800,
  });

  let parsed;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match?.[0] || raw);
  } catch {
    throw new Error("AI response could not be parsed");
  }

  if (!parsed?.subject || !parsed?.htmlContent) {
    throw new Error("AI returned incomplete copy");
  }

  // Guardrail: strip any URLs or price patterns the model might have slipped in
  const stripUnsafe = (s = "") =>
    s.replace(/https?:\/\/\S+/gi, "[link]")
     .replace(/\b(₹|INR|USD|\$|AED|£|€)\s*[\d,]+/gi, "[price]")
     .replace(/\b[A-Z]{4,}\d{1,2}\b/g, "[code]"); // coupon-like patterns

  const result = {
    subject:      stripUnsafe(parsed.subject),
    previewText:  stripUnsafe(parsed.previewText || ""),
    htmlContent:  stripUnsafe(parsed.htmlContent),
    abVariants:   (parsed.abVariants || []).map(stripUnsafe),
  };

  await Campaign.updateOne(
    { _id: campaignId },
    {
      $set: {
        subject:     result.subject,
        previewText: result.previewText,
        htmlContent: result.htmlContent,
        variants:    result.abVariants.map((s, i) => ({
          name:        `Variant ${String.fromCharCode(65 + i)}`,
          subject:     s,
          htmlContent: result.htmlContent,
          weight:      50,
        })).slice(0, 2),
      },
    }
  );

  return result;
}
