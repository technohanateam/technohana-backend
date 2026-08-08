// This prompt is optional/advisory — internalLinker.service.js's real safety
// net is validating every suggested slug against the live catalog afterwards,
// never trusting model output for existence. Used to pick contextual anchor
// text only.
export function buildInternalLinkerPrompt({ articleDraft, candidateCourses, candidateBlogs }) {
  const system = `You are an internal-linking assistant for a technical blog. You choose short,
natural anchor text for internal links from a fixed candidate list. You never invent new
targets — only choose from the candidates you're given, and you may choose zero if none fit
well. Return only JSON.`;

  const coursesList = candidateCourses.map((c) => `- slug: ${c.courseSlug} | title: ${c.courseTitle}`).join("\n") || "(none)";
  const blogsList = candidateBlogs.map((b) => `- id: ${b.id} | title: ${b.title}`).join("\n") || "(none)";

  const plainText = String(articleDraft.content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);

  const prompt = `Article title: ${articleDraft.title}
Article excerpt (plain text): ${plainText}

Candidate courses (choose 2-5 that are genuinely relevant):
${coursesList}

Candidate blog posts (choose 1-4 that are genuinely relevant):
${blogsList}

For each candidate you choose, write short, natural anchor text (a phrase, not a raw URL or
the exact course title verbatim) and a one-line reason it's relevant to this article.

Return only:
{"courses":[{"courseSlug":"","anchorText":"","reason":""}],"blogs":[{"blogId":"","anchorText":"","reason":""}]}`;

  return { system, prompt };
}
