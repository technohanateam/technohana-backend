import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildImagePromptWriterPrompt } from "../../prompts/contentFactory/imagePromptWriter.prompt.js";

export { buildImagePromptWriterPrompt };

const fallbackFilename = (title) =>
  `${String(title || "cover")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60)}.jpg`;

// Parses a manually-pasted Claude Pro response producing a cover-image
// CONCEPT — never a real image. Must never block article completion: any
// parse failure (or empty paste) falls back to a minimal derived concept
// instead of throwing.
export function parseImageConceptResponse(text, articleDraft, opportunity) {
  const title = articleDraft.title || opportunity.title;

  try {
    if (!text) throw new Error("No image concept response provided.");
    const parsed = parseModelJson(text);

    const imageConcept = {
      prompt: parsed.prompt || `Editorial cover image concept for "${title}".`,
      altText: parsed.altText || title,
      suggestedFilename: parsed.suggestedFilename || fallbackFilename(title),
      tier: "AI_PROMPT_ONLY",
      imageUrl: null,
      status: "IMAGE_PENDING",
    };
    return { imageConcept };
  } catch (err) {
    const imageConcept = {
      prompt: `A clean, professional editorial cover image representing the topic: "${title}". No text overlays, no logos.`,
      altText: title,
      suggestedFilename: fallbackFilename(title),
      tier: "AI_PROMPT_ONLY",
      imageUrl: null,
      status: "IMAGE_PENDING",
    };
    return { imageConcept, fallback: true, error: err.message };
  }
}
