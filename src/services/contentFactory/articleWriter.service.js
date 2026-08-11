import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildArticleWriterPrompts } from "../../prompts/contentFactory/articleWriter.prompt.js";
import Course from "../../models/course.model.js";

// Manual Claude Pro workflow — builds the single-shot article prompt (the
// admin pastes this into Claude Pro chat, which has its own web search, then
// pastes the response back for parseArticleResponse below).
export async function buildArticleWriterPrompt(brief, opportunity) {
  let relatedCoursesBullets = "  (none — use only the main course link above)";
  try {
    if (opportunity.category) {
      const related = await Course.find({ category: opportunity.category, id: { $ne: opportunity.courseId } })
        .select("id courseTitle")
        .limit(3)
        .lean();
      if (related.length) {
        relatedCoursesBullets = related.map((c) => `  • <a href="/courses/${c.id}">${c.courseTitle}</a>`).join("\n");
      }
    }
  } catch {
    // Non-fatal — fall back to the default bullets text above.
  }

  return buildArticleWriterPrompts({ brief, opportunity, relatedCoursesBullets });
}

// Parses the manually-pasted Claude Pro response into an articleDraft.
export function parseArticleResponse(finalText, brief, opportunity) {
  if (!finalText) throw new Error("No article response provided.");

  let generated;
  try {
    generated = parseModelJson(finalText);
  } catch (err) {
    throw new Error(`Failed to parse article writer AI response: ${err.message}`);
  }

  const wordCount = String(generated.content || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const readTimeMin = generated.readTimeMin || Math.max(1, Math.round(wordCount / 200));

  const articleDraft = {
    title: generated.title || brief.title,
    slug: generated.slug || null,
    content: generated.content || "",
    excerpt: generated.excerpt || "",
    metaTitle: generated.metaTitle || "",
    metaDescription: generated.metaDescription || "",
    tags: Array.isArray(generated.tags) ? generated.tags : [],
    readTimeMin,
    sources: Array.isArray(generated.sources) ? generated.sources : [],
    faqs: Array.isArray(generated.faqs) ? generated.faqs : [],
    suggestedInternalLinks: { courses: [], blogs: [] },
    // Non-Blogs-schema fields the SEO/link steps still need downstream.
    focusKeyword: generated.focusKeyword || null,
    author: generated.author || null,
    category: generated.category || opportunity.category || null,
  };

  return { articleDraft };
}
