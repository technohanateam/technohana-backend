// Content brief generation prompt (Milestone 2). One Claude call, tier:"standard",
// takes a ContentOpportunity and produces a structured writing brief that the
// article writer step consumes — no web search here, this is planning only.
export function buildContentBriefPrompt(opportunity) {
  const system = `You are Technohana's Senior Content Strategist. You turn a single content
opportunity into a precise, actionable writing brief for a technical content writer.

Rules:
- Ground every suggestion in the opportunity data you're given — do not invent course
  facts, statistics, or company claims.
- Prefer concrete, specific headings and questions over generic ones.
- Keep internal link suggestions plausible (real course/blog topics implied by the
  category and course title given) — the writer will validate them against the real
  catalog later, so it's fine to suggest a course by likely slug/topic even if you
  can't confirm the exact slug.
- Return ONLY valid JSON. No markdown fences. No commentary.`;

  const prompt = `Content opportunity:
Title: ${opportunity.title}
Content type: ${opportunity.contentType}
Category: ${opportunity.category || "n/a"}
Course: ${opportunity.courseTitle || "n/a"} (slug: ${opportunity.courseSlug || "n/a"})
Focus keyword: ${opportunity.focusKeyword || "n/a"}
Secondary keywords: ${(opportunity.secondaryKeywords || []).join(", ") || "n/a"}
Search intent: ${opportunity.searchIntent}
Topic angle: ${opportunity.topicAngle || "n/a"}
Recommendation reason: ${opportunity.recommendationReason || "n/a"}
Target audience hint: ${opportunity.targetAudience || "n/a"}

Produce a writing brief as this exact JSON shape:
{
  "title": "",
  "searchIntent": "",
  "targetAudience": "",
  "primaryKeyword": "",
  "secondaryKeywords": [""],
  "topicAngle": "",
  "headings": [{"level": 2, "text": ""}],
  "questionsToAnswer": [""],
  "suggestedExamples": [""],
  "contentGaps": [""],
  "internalLinkTargets": {
    "courses": [{"courseSlug": "", "reason": ""}],
    "blogs": [{"blogId": "", "reason": ""}]
  },
  "ctaRecommendation": "",
  "sourceRecommendations": [""],
  "depthGuidance": "STANDARD"
}

depthGuidance must be one of SHORT, STANDARD, COMPREHENSIVE based on the content type and
topic complexity (e.g. FAQ/CHECKLIST tends to be SHORT, ADVANCED_GUIDE/CASE_STUDY tends to
be COMPREHENSIVE). Provide 4-7 headings, 3-6 questions, 2-4 examples.`;

  return { system, prompt };
}
