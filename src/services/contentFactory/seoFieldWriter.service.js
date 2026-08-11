import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildSeoFieldWriterPrompt } from "../../prompts/contentFactory/seoFieldWriter.prompt.js";

export { buildSeoFieldWriterPrompt };

// Parses a manually-pasted Claude Pro response into refined/generated
// metaTitle, metaDescription, focusKeyword, tags for an articleDraft. Returns
// the merged fields only — the orchestrator is responsible for actually
// writing them onto the opportunity.
export function parseSeoFieldsResponse(text, articleDraft, brief) {
  let parsed;
  try {
    parsed = parseModelJson(text);
  } catch (err) {
    throw new Error(`Failed to parse SEO field writer AI response: ${err.message}`);
  }

  const seoFields = {
    metaTitle: parsed.metaTitle || articleDraft.metaTitle || "",
    metaDescription: parsed.metaDescription || articleDraft.metaDescription || "",
    focusKeyword: parsed.focusKeyword || brief?.primaryKeyword || articleDraft.focusKeyword || "",
    tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags : articleDraft.tags || [],
  };

  return { seoFields };
}
