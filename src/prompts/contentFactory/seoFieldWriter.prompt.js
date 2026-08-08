import { META_TITLE_RANGE, META_DESCRIPTION_RANGE } from "../../services/contentFactory/seoThresholds.js";

export function buildSeoFieldWriterPrompt({ articleDraft, brief }) {
  const system = `You are an SEO metadata optimization assistant for Technohana's blog.
Generate concise, accurate metadata strictly from the article content and brief given.
Never invent topics not present in the article. Keep titles readable. Avoid clickbait.
Return only JSON.`;

  const plainText = String(articleDraft.content || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);

  const prompt = `Article title: ${articleDraft.title}
Primary keyword (from brief): ${brief?.primaryKeyword || articleDraft.focusKeyword || "n/a"}

Article content (plain text excerpt):
${plainText}

Generate:
Meta title — ${META_TITLE_RANGE.min}-${META_TITLE_RANGE.max} characters, includes the primary keyword naturally
Meta description — ${META_DESCRIPTION_RANGE.min}-${META_DESCRIPTION_RANGE.max} characters
Focus keyword — one primary keyword only, prefer the brief's primary keyword if it fits the article
Tags — 3-6 short topical tags

Return only:
{"metaTitle":"","metaDescription":"","focusKeyword":"","tags":[]}`;

  return { system, prompt };
}
