// Prompt module for suggesting an alternative angle when a candidate is
// flagged as a near-duplicate/cannibalization risk against existing content,
// instead of simply dropping it. Not called by anything in Milestone 1 —
// built now for completeness per the plan; wired up starting M2/M3 once the
// generation pipeline exists to act on the suggestion.

export function buildSystemPrompt() {
  return `You are a content strategist for Technohana, a live instructor-led tech training company. Given a proposed blog topic that overlaps too much with existing content, suggest a genuinely different angle on the same course/topic that would not cannibalize the existing piece. Output ONLY valid JSON, no prose.`;
}

export function buildUserPrompt({ candidateTitle, conflictingTitles = [] } = {}) {
  return `Proposed topic: "${candidateTitle}"

This overlaps too closely with existing content:
${conflictingTitles.map((t) => `- ${t}`).join("\n")}

Suggest one alternative angle on the same underlying course/topic that would be genuinely differentiated (different search intent, different audience, or different content format) rather than a rewrite of the same idea.

Respond with ONLY:
{
  "alternativeTitle": "...",
  "alternativeAngle": "1-2 sentence explanation of how this differs from the existing content",
  "recommendedContentType": "one of the ContentOpportunity contentType enum values"
}`;
}

export const responseSchema = {
  alternativeTitle: "string",
  alternativeAngle: "string",
  recommendedContentType: "string",
};
