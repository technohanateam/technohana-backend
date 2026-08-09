// qualityGate.service.js's combined dimension scorer — everything except
// seoScore (computed deterministically from seoThresholds.js) and
// internalLinksScore (computed from actual link counts) and aiStyleRiskScore
// (its own dedicated cheap call in aiStyleEvaluator.service.js).
export function buildQualityEvaluatorPrompt({ articleDraft, brief, opportunity }) {
  const system = `You are a senior content editor scoring a draft blog article across several
editorial dimensions for Technohana, an IT/professional training company. Score honestly —
these scores gate whether the article needs a revision pass before a human reviews it, so
inflating scores defeats the purpose.

Score each dimension 0-100:
- originalityScore: how much this reads as a distinctive take vs. generic/interchangeable content
- readabilityScore: clarity, pacing, paragraph/sentence structure, jargon explained appropriately
- courseRelevanceScore: how well the article connects to and supports the tied course/topic
- searchIntentAlignmentScore: how well the content matches the stated search intent
- ctaRelevanceScore: how naturally and relevantly the article leads toward course enrollment
  (not pushy, but a genuine relevant call to action/course connection)
- specificityScore: concrete examples/scenarios/numbers vs. vague generalities
- originalInsightScore: does the article offer a genuine angle/insight vs. just restating
  common knowledge
- editorialQualityScore: overall polish — grammar, structure, coherence, would a human editor
  approve this with minimal changes

Return ONLY valid JSON. No markdown. No explanations outside the JSON.`;

  const plainText = String(articleDraft?.content || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);

  const prompt = `Article title: ${articleDraft?.title || "(untitled)"}
Search intent: ${brief?.searchIntent || opportunity?.searchIntent || "n/a"}
Target audience: ${brief?.targetAudience || opportunity?.targetAudience || "n/a"}
Tied course: ${opportunity?.courseTitle || "(none)"}

Article content (plain text):
${plainText}

Return ONLY this JSON object:
{"originalityScore":0,"readabilityScore":0,"courseRelevanceScore":0,"searchIntentAlignmentScore":0,"ctaRelevanceScore":0,"specificityScore":0,"originalInsightScore":0,"editorialQualityScore":0}`;

  return { system, prompt };
}
