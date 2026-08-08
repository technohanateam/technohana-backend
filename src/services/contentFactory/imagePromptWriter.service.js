import { callClaude } from "../aiAgent.service.js";
import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildImagePromptWriterPrompt } from "../../prompts/contentFactory/imagePromptWriter.prompt.js";

const fallbackFilename = (title) =>
  `${String(title || "cover")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60)}.jpg`;

// ONE cheap-tier Claude call producing a cover-image CONCEPT — never a real
// image. Real image generation is explicitly out of scope for this whole
// project. Must never block article completion: any failure here falls back
// to a minimal derived concept instead of throwing.
export async function generateImageConcept(articleDraft, opportunity) {
  const title = articleDraft.title || opportunity.title;

  try {
    const { system, prompt } = buildImagePromptWriterPrompt({ articleDraft, opportunity });
    const { text, usage, model } = await callClaude({ system, prompt, maxTokens: 400, tier: "cheap" });
    const parsed = parseModelJson(text);

    const imageConcept = {
      prompt: parsed.prompt || `Editorial cover image concept for "${title}".`,
      altText: parsed.altText || title,
      suggestedFilename: parsed.suggestedFilename || fallbackFilename(title),
      tier: "AI_PROMPT_ONLY",
      imageUrl: null,
      status: "IMAGE_PENDING",
    };
    return { imageConcept, usage, model };
  } catch (err) {
    // Never throw — return a minimal fallback so image concept generation
    // can never block the rest of the pipeline.
    const imageConcept = {
      prompt: `A clean, professional editorial cover image representing the topic: "${title}". No text overlays, no logos.`,
      altText: title,
      suggestedFilename: fallbackFilename(title),
      tier: "AI_PROMPT_ONLY",
      imageUrl: null,
      status: "IMAGE_PENDING",
    };
    return { imageConcept, usage: null, model: null, fallback: true, error: err.message };
  }
}
