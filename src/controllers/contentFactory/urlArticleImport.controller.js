import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildOpportunityFromImport } from "../../services/contentFactory/articleImport.service.js";
import { isSsrfBlocked, fetchAndBuildUrlPrompt } from "../../services/contentFactory/urlImport.service.js";

// POST /admin/content-factory/import/url — AI-generate a blog post from live
// URLs and route it into the Opportunity review pipeline.
//
// Manual Claude Pro workflow: first call fetches+extracts the URLs (needed
// either way) and returns the built prompt; second call (pastedResponse set)
// re-fetches the same URLs (cheap, deterministic, avoids round-tripping
// scraped page text through the client) to rebuild sourcesList, parses the
// pasted JSON, then creates a ContentOpportunity in Human Review instead of
// returning the draft for a direct Blogs save.
export const generateFromUrls = async (req, res) => {
  const { urls, topic, category, focusKeyword, relatedCourses = [], courseSlug, courseTitle, pastedResponse } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ success: false, message: "Provide at least one URL." });
  }
  if (urls.length > 5) {
    return res.status(400).json({ success: false, message: "Maximum 5 URLs allowed." });
  }
  if (urls.some(isSsrfBlocked)) {
    return res.status(400).json({ success: false, message: "One or more URLs are not allowed." });
  }

  if (!pastedResponse) {
    const { failedUrls, systemPrompt, userPrompt } = await fetchAndBuildUrlPrompt({ urls, topic, category, focusKeyword, relatedCourses });
    return res.json({
      success: true,
      awaitingInput: true,
      prompts: [{ label: "Blog post", system: systemPrompt, prompt: userPrompt }],
      ...(failedUrls.length ? { warnings: failedUrls } : {}),
    });
  }

  try {
    // sources are deterministic from the input URLs (with titles fetched
    // server-side) rather than trusted to the model, which could otherwise
    // invent or drop entries.
    const { sourcesList, failedUrls } = await fetchAndBuildUrlPrompt({ urls, topic, category, focusKeyword, relatedCourses });

    let generated;
    try {
      generated = parseModelJson(pastedResponse);
    } catch {
      generated = null;
    }
    if (!generated) {
      console.error("import/url: failed to parse pasted response. Raw:", String(pastedResponse).slice(0, 500));
      return res.status(500).json({ success: false, message: "Failed to parse the pasted response. Make sure it's the full JSON reply." });
    }
    generated.sources = sourcesList;

    const opportunity = await buildOpportunityFromImport({
      articleDraft: generated,
      courseSlug: courseSlug || null,
      courseTitle: courseTitle || null,
      category: category || null,
      contentType: "TRENDING",
      importedBy: req.admin?.name || req.admin?.email || req.admin?.uid || null,
      origin: "URL_AI_IMPORT",
    });
    await opportunity.save();

    return res.json({ success: true, data: opportunity, ...(failedUrls.length ? { warnings: failedUrls } : {}) });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error("[ContentFactory] generateFromUrls error:", err);
    return res.status(statusCode).json({ success: false, message: err.message || "Server error" });
  }
};
