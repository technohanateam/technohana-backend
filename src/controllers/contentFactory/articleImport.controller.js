import { parseMarkdownArticle, buildOpportunityFromImport } from "../../services/contentFactory/articleImport.service.js";

// POST /admin/content-factory/import
// Accepts a human-written markdown article and routes it into the same
// review/score/approve pipeline AI-generated opportunities use, instead of
// writing straight to Blogs (see src/addBlogAiEngineeringSkills2026.js for
// that older, opportunity-bypassing pattern).
export const importArticle = async (req, res) => {
  try {
    const { markdown, courseSlug, courseTitle, category, contentType, sourceFile } = req.body || {};
    if (!markdown || !String(markdown).trim()) {
      return res.status(400).json({ success: false, message: "markdown is required" });
    }

    const { articleDraft, warnings } = parseMarkdownArticle(markdown);
    const importedBy = req.admin?.name || req.admin?.email || req.admin?.uid || null;

    const opportunity = await buildOpportunityFromImport({
      articleDraft,
      courseSlug: courseSlug || null,
      courseTitle: courseTitle || null,
      category: category || null,
      contentType: contentType || undefined,
      importedBy,
      sourceFile: sourceFile || null,
    });
    await opportunity.save();

    return res.json({ success: true, data: opportunity, warnings, message: "Article imported into review queue" });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error("[ContentFactory] importArticle error:", err);
    return res.status(statusCode).json({ success: false, message: err.message || "Server error" });
  }
};
