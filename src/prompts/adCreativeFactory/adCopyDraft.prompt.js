// Ad copy variant generation prompt. One Claude call — turns a creative brief
// into headline/primary-text/description/CTA variant sets for A/B testing.
export function buildAdCopyDraftPrompt({ brief, opportunity, settings }) {
  const variantsPerAdSet = settings?.variantsPerAdSet || 3;
  const limits = settings?.platformLengthLimits || {};
  const platforms = opportunity.platform === "BOTH" ? ["META", "LINKEDIN"] : [opportunity.platform];

  const limitLines = platforms
    .map((p) => {
      const key = p.toLowerCase();
      const l = limits[key] || {};
      return `${p}: headline <= ${l.headline || "n/a"} chars, primary text <= ${l.primaryText || "n/a"} chars, description <= ${l.description || "n/a"} chars`;
    })
    .join("\n");

  const system = `You are Technohana's Senior Ad Copywriter. You write direct-response ad
copy variants for paid social campaigns from an approved creative brief.

Rules:
- Never make guarantee-style claims ("guaranteed job", "100% placement", "guaranteed
  salary increase") — Technohana never promises specific outcomes in ads.
- Write variants that differ meaningfully from each other (different hooks/angles), not
  synonym-swaps of the same sentence.
- Respect the platform character limits given — write to fit, don't rely on later truncation.
- Return ONLY valid JSON. No markdown fences. No commentary.`;

  const prompt = `Creative brief:
Angle: ${brief.angle}
Key selling points: ${(brief.keySellingPoints || []).join("; ")}
Tone: ${brief.tone}
Target audience: ${brief.targetAudience}
Pain point: ${brief.painPoint || "n/a"}
Proof point: ${brief.proofPoint || "n/a"}

Course: ${opportunity.courseTitle || "n/a"}
Campaign objective: ${opportunity.campaignObjective}
Platform(s): ${platforms.join(", ")}

Platform length limits:
${limitLines}

Produce ${variantsPerAdSet} variants each of headlines, primary texts, and descriptions, plus 2-3 CTA
options, as this exact JSON shape (repeat one object per platform in "platform"):
{
  "headlines": [{"text": "", "platform": "META"}],
  "primaryTexts": [{"text": "", "platform": "META"}],
  "descriptions": [{"text": "", "platform": "META"}],
  "ctas": [{"text": "", "platform": "META"}]
}`;

  return { system, prompt };
}
