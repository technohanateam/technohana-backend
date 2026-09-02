import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildOpportunityFromImport } from "../../services/contentFactory/articleImport.service.js";

// POST /admin/content-factory/import/course
//
// Manual Claude Pro workflow (mirrors Content Factory / Course Factory —
// ANTHROPIC_API_KEY has no working billing): first call (no pastedResponse)
// returns the prompt for the admin to run in Claude Pro chat themselves,
// including its own web search where the prompt asks for one; second call
// (with pastedResponse) parses what they paste back and creates a
// ContentOpportunity in Human Review, same as every other creation path,
// instead of returning the draft for a direct Blogs save.
export const generateFromCourse = async (req, res) => {
  try {
    const { courseId, courseTitle, category, description, relatedCourses = [], pastedResponse } = req.body;
    if (!courseTitle) return res.status(400).json({ message: "courseTitle is required." });

    const year = new Date().getFullYear();

    const sanitize = (str) => String(str || "").replace(/[`${}]/g, "");
    const relatedCoursesBullets = Array.isArray(relatedCourses) && relatedCourses.length
      ? relatedCourses.map(c => `  • <a href="/courses/${sanitize(c.id)}">${sanitize(c.title)}</a>`).join("\n")
      : "  (none — use only the main course link above)";

    const systemPrompt = `You are Technohana's Senior SEO Content Strategist and Technical Writer.

Your goal is to produce authoritative, accurate, search-optimized technical blog articles that rank well on search engines while genuinely helping readers.

You have access to a web search tool.

Before writing:
1. Search for recent information.
2. Verify facts.
3. Use only information supported by search results.
4. Never invent statistics, rankings, salaries, certifications, trends, company statements, or URLs.

Writing style:
• Professional and educational
• Clear and concise
• Technical where appropriate
• Written for professionals, students, developers and decision makers
• Avoid marketing hype
• Avoid exaggerated claims
• Never use emojis
• Use short paragraphs
• Prefer bullet lists where useful
• Explain technical concepts simply

SEO Requirements:
• Naturally use the focus keyword.
• Include it in the title, first paragraph, one H2, and conclusion.
• Write compelling metadata.
• Avoid keyword stuffing.
• Create human-first content.

HTML Requirements:
Only return HTML inside the content field.
Allowed tags: <p> <h2> <h3> <ul> <ol> <li> <strong> <em> <a>
Never use inline CSS.
Internal links must be naturally integrated into relevant sentences.
External links should never be inserted into the HTML. Only list them in sources.
If a fact cannot be verified from search results, omit it.

Return ONLY valid JSON. No markdown. No explanations.`;

    const userPrompt = `Create a long-form SEO blog post for Technohana.

Course
Title: ${courseTitle}
Year: ${year}
${description ? `Description: ${description}` : ""}

Search the web before writing. Perform searches similar to:
- "${courseTitle} trends ${year}"
- "${courseTitle} jobs salary demand ${year}"
- "${courseTitle} certifications ${year}"
- "${courseTitle} enterprise adoption ${year}"

After collecting information, create a blog with these requirements.

Requirements
Length: 700–1200 words
Structure: Introduction, 4–5 H2 sections, Conclusion, 3–5 FAQs
Tone: Educational, Objective, Actionable, Trustworthy
Use examples where appropriate.
Never fabricate statistics. If statistics are unavailable, discuss trends qualitatively.

Internal links — naturally include these in the article:
Primary Course: <a href="/courses/${courseId}">${courseTitle}</a>
Related Courses:
${relatedCoursesBullets}
Blog: <a href="/blog/">the Technohana blog</a>

Do NOT create a "Recommended Courses" section. Integrate links naturally into paragraphs.

SEO — generate: title, slug, excerpt, meta title (50–60 chars), meta description (140–160 chars), focus keyword, tags, read time, author, category.

Return ONLY this JSON object:
{"title":"","slug":"","excerpt":"","content":"","metaTitle":"","metaDescription":"","focusKeyword":"","tags":[],"readTimeMin":0,"author":"","category":"","sources":[{"title":"","url":""}],"faqs":[{"question":"","answer":""}]}

Sources: only URLs returned by web search, each as {"title": "<page title>", "url": "<url>"}. Never invent URLs.

If you have web search available, search the web before writing (queries like "${courseTitle} trends ${year}", "${courseTitle} jobs salary demand ${year}", "${courseTitle} certifications ${year}", "${courseTitle} enterprise adoption ${year}") and ground the article in what you find.`;

    if (!pastedResponse) {
      return res.json({ success: true, awaitingInput: true, prompts: [{ label: "Blog post", system: systemPrompt, prompt: userPrompt }] });
    }

    let generated;
    try {
      generated = parseModelJson(pastedResponse);
    } catch {
      generated = null;
    }
    if (!generated) {
      console.error("generate-from-course: failed to parse pasted response. Raw:", String(pastedResponse).slice(0, 500));
      return res.status(500).json({ success: false, message: "Failed to parse the pasted response. Make sure it's the full JSON reply." });
    }

    const opportunity = await buildOpportunityFromImport({
      articleDraft: generated,
      courseSlug: courseId || null,
      courseTitle,
      category: category || null,
      contentType: "COURSE_GUIDE",
      importedBy: req.admin?.name || req.admin?.email || req.admin?.uid || null,
      origin: "COURSE_AI_IMPORT",
    });
    await opportunity.save();

    return res.json({ success: true, data: opportunity });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error("Blog generation error:", err?.response?.data?.error?.message || err.message);
    return res.status(statusCode).json({ success: false, message: err.message || "Failed to generate blog." });
  }
};
