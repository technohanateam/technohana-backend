// Cover-image CONCEPT only — no image is ever generated from this (out of
// scope for the whole project). One cheap-tier call producing a text prompt,
// alt text, and a suggested filename a human could later use to source or
// generate a real cover image manually.
export function buildImagePromptWriterPrompt({ articleDraft, opportunity }) {
  const system = `You describe cover-image concepts for a technical education blog. You never
generate images — you only write a clear, concrete visual concept description, accessible alt
text, and a filesystem-safe suggested filename. Return only JSON.`;

  const prompt = `Article title: ${articleDraft.title || opportunity.title}
Category: ${articleDraft.category || opportunity.category || "Technology"}
Excerpt: ${articleDraft.excerpt || opportunity.recommendationReason || "n/a"}

Describe a cover image concept suitable for a professional technical education blog (no text
overlays, no logos, brand-neutral, evokes the topic clearly, photographic or clean illustrative
style).

Return only:
{"prompt":"","altText":"","suggestedFilename":""}

suggestedFilename should be lowercase, hyphenated, end in .jpg, and be derived from the title.`;

  return { system, prompt };
}
