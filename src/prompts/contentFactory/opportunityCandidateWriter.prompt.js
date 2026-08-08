// Prompt module for contentStrategy.service.js — one BATCHED call covering
// every surviving-dedup candidate in a planning run (never one call per
// candidate), asking for the creative/strategic fields for each.

export function buildSystemPrompt() {
  return `You are a senior content strategist for Technohana, a live instructor-led tech training company selling individual, group, and corporate training in India, UAE, US, UK, and EU. For each candidate content idea below (course + content type pairing), propose the concrete creative brief fields a writer would need. Be specific to the course and content type — do not write generic filler. Output ONLY valid JSON, no prose.`;
}

export function buildUserPrompt({ candidates = [] } = {}) {
  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. courseTitle="${c.courseTitle}", category="${c.category || "n/a"}", contentType="${c.contentType}", clusterName="${c.clusterName || "n/a"}", priorityTier="${c.priorityTier || "n/a"}"`
    )
    .join("\n");

  return `Candidates:
${list}

For EACH candidate (same order, same count), respond with:
{
  "opportunities": [
    {
      "title": "Compelling, specific blog title (avoid generic AI phrasing)",
      "focusKeyword": "primary SEO keyword phrase",
      "secondaryKeywords": ["keyword1", "keyword2", "keyword3"],
      "searchIntent": "INFORMATIONAL" | "EDUCATIONAL" | "COMMERCIAL_INVESTIGATION" | "TRANSACTIONAL" | "NAVIGATIONAL",
      "businessIntentScore": 0-100,
      "courseRelevanceScore": 0-100,
      "targetAudience": "who this content is for",
      "topicAngle": "1-2 sentence unique angle for this piece",
      "recommendationReason": "1 sentence: why this is worth writing now"
    }
  ]
}

Return exactly ${candidates.length} objects in the "opportunities" array, in the same order as the candidates list.`;
}

export const responseSchema = {
  opportunities: [
    {
      title: "string",
      focusKeyword: "string",
      secondaryKeywords: ["string"],
      searchIntent: "string",
      businessIntentScore: "number",
      courseRelevanceScore: "number",
      targetAudience: "string",
      topicAngle: "string",
      recommendationReason: "string",
    },
  ],
};
