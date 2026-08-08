import { callClaude } from "../aiAgent.service.js";
import { parseModelJson } from "../../utils/parseModelJson.js";
import ContentBrief from "../../models/contentBrief.model.js";
import { buildContentBriefPrompt } from "../../prompts/contentFactory/contentBrief.prompt.js";

const VALID_DEPTHS = ["SHORT", "STANDARD", "COMPREHENSIVE"];

// Does one AI thing (write a brief) and persists it. Status transitions on
// the opportunity belong to the orchestrator, not here.
export async function generateContentBrief(opportunity) {
  const { system, prompt } = buildContentBriefPrompt(opportunity);
  const { text, usage, model } = await callClaude({ system, prompt, maxTokens: 2048, tier: "standard" });

  let parsed;
  try {
    parsed = parseModelJson(text);
  } catch (err) {
    throw new Error(`Failed to parse content brief AI response: ${err.message}`);
  }

  const depthGuidance = VALID_DEPTHS.includes(parsed.depthGuidance) ? parsed.depthGuidance : "STANDARD";

  const briefDoc = await ContentBrief.findOneAndUpdate(
    { opportunityId: opportunity._id },
    {
      opportunityId: opportunity._id,
      title: parsed.title || opportunity.title,
      searchIntent: parsed.searchIntent || opportunity.searchIntent || null,
      targetAudience: parsed.targetAudience || null,
      primaryKeyword: parsed.primaryKeyword || opportunity.focusKeyword || null,
      secondaryKeywords: Array.isArray(parsed.secondaryKeywords) ? parsed.secondaryKeywords : [],
      topicAngle: parsed.topicAngle || opportunity.topicAngle || null,
      headings: Array.isArray(parsed.headings) ? parsed.headings : [],
      questionsToAnswer: Array.isArray(parsed.questionsToAnswer) ? parsed.questionsToAnswer : [],
      suggestedExamples: Array.isArray(parsed.suggestedExamples) ? parsed.suggestedExamples : [],
      contentGaps: Array.isArray(parsed.contentGaps) ? parsed.contentGaps : [],
      internalLinkTargets: {
        courses: Array.isArray(parsed.internalLinkTargets?.courses) ? parsed.internalLinkTargets.courses : [],
        blogs: Array.isArray(parsed.internalLinkTargets?.blogs) ? parsed.internalLinkTargets.blogs : [],
      },
      courseId: opportunity.courseId || null,
      ctaRecommendation: parsed.ctaRecommendation || null,
      sourceRecommendations: Array.isArray(parsed.sourceRecommendations) ? parsed.sourceRecommendations : [],
      depthGuidance,
      generatedByModel: model,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return { brief: briefDoc, usage, model };
}
