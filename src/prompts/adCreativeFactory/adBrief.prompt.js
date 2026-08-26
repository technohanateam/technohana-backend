// Ad creative brief prompt. One Claude call — turns a course + campaign
// objective + platform into a short creative brief (angle, selling points,
// tone) that the copy-draft step consumes. No web search, planning only.
export function buildAdBriefPrompt(opportunity) {
  const system = `You are Technohana's Senior Performance Marketing Strategist. You turn a
single ad creative request into a precise, actionable creative brief for a copywriter.

Rules:
- Ground every suggestion in the course data you're given — never invent course facts,
  pricing, or outcomes not implied by the input.
- Never suggest claims that sound like a guarantee ("guaranteed job", "100% placement",
  "guaranteed salary increase") — performance-based promises are not something Technohana
  makes in ads.
- Keep the angle concrete and specific to the platform and objective given.
- Return ONLY valid JSON. No markdown fences. No commentary.`;

  const prompt = `Ad creative request:
Course: ${opportunity.courseTitle || "n/a"} (slug: ${opportunity.courseSlug || "n/a"})
Campaign objective: ${opportunity.campaignObjective}
Platform: ${opportunity.platform}
Target audience: ${opportunity.targetAudience || "n/a"}
Angle hint: ${opportunity.angle || "n/a"}

Produce a creative brief as this exact JSON shape:
{
  "angle": "",
  "keySellingPoints": [""],
  "tone": "",
  "targetAudience": "",
  "painPoint": "",
  "proofPoint": ""
}

Provide 3-5 key selling points, grounded in the course and objective above.`;

  return { system, prompt };
}
