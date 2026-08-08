import { trackedCallClaude } from "./aiUsageTracker.service.js";
import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildSeoFieldWriterPrompt } from "../../prompts/contentFactory/seoFieldWriter.prompt.js";

// Refines/generates metaTitle, metaDescription, focusKeyword, tags on an
// articleDraft. Returns the merged fields only — the orchestrator is
// responsible for actually writing them onto the opportunity.
export async function writeSeoFields(articleDraft, brief) {
  const { system, prompt } = buildSeoFieldWriterPrompt({ articleDraft, brief });
  const { text, usage, model } = await trackedCallClaude({ system, prompt, maxTokens: 512, tier: "cheap", callType: "seo", opportunityId: brief?.opportunityId || null });

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

  return { seoFields, usage, model };
}
