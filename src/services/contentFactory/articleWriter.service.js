import axios from "axios";
import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildArticleWriterPrompts } from "../../prompts/contentFactory/articleWriter.prompt.js";
import Course from "../../models/course.model.js";
import { recordAiUsage } from "./aiUsageTracker.service.js";

// THE KEY REUSE STEP — this is a deliberate COPY (not a refactor-in-place)
// of admin.routes.js's `POST /admin/blogs/generate-from-course` agentic
// web_search loop, parameterized on a ContentBrief instead of raw course
// fields. The existing route's inline logic is left completely untouched to
// avoid any regression risk to that already-working, must-not-break route —
// see plan decision + "Notable deviations" in the plan file.
export async function writeArticle(brief, opportunity) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

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

  const { system, prompt } = buildArticleWriterPrompts({ brief, opportunity, relatedCoursesBullets });

  const messages = [{ role: "user", content: prompt }];
  const tools = [{ type: "web_search_20260209", name: "web_search" }];
  let finalText = "";
  let model = "claude-sonnet-5";
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let turn = 0; turn < 5; turn++) {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model,
        max_tokens: 8192,
        system,
        tools,
        messages,
      },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        // 180s, not the 120s generate-from-course uses (a separate, untouched
        // file/call): a live validation run (2026-08-08) found brief-driven
        // generation — more search turns, a longer structured prompt than the
        // course-only original — timed out at 120s in 2 of 3 real attempts.
        // This runs inside an async Bull job, not an HTTP request an admin is
        // waiting on, so the extra headroom has no UX cost.
        timeout: 180000,
      }
    );

    const { stop_reason, content, usage: turnUsage } = response.data;
    if (turnUsage) {
      usage.input_tokens += turnUsage.input_tokens || 0;
      usage.output_tokens += turnUsage.output_tokens || 0;
    }

    messages.push({ role: "assistant", content });

    if (stop_reason === "end_turn") {
      const textBlock = content.find((b) => b.type === "text");
      finalText = textBlock?.text?.trim() || "";
      break;
    }

    if (stop_reason === "tool_use") {
      continue;
    }

    break;
  }

  // Milestone 4: this loop calls the Anthropic API directly (axios, not
  // callClaude()), so it can't go through trackedCallClaude() — still record
  // the accumulated token usage as its own AiUsageLog row for cost visibility
  // on what's likely the most expensive single step in the pipeline.
  await recordAiUsage({
    model,
    tier: "standard",
    tokensIn: usage.input_tokens,
    tokensOut: usage.output_tokens,
    callType: "article",
    opportunityId: opportunity?._id || null,
  });

  if (!finalText) throw new Error("Claude did not produce a final response for the article.");

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

  return { articleDraft, usage, model };
}
