import { buildOpportunityFromImport } from "../../services/contentFactory/articleImport.service.js";

// POST /admin/content-factory/import/manual
// Seeds a blank ContentOpportunity for the "New Post" button so a fully
// hand-written blog still goes through Human Review / approve like every
// other creation path, instead of writing straight to Blogs.
export const createManualOpportunity = async (req, res) => {
  try {
    const { title, category, courseSlug, courseTitle } = req.body || {};

    const opportunity = await buildOpportunityFromImport({
      articleDraft: { title: title?.trim() || "Untitled Post", content: "" },
      category: category || null,
      courseSlug: courseSlug || null,
      courseTitle: courseTitle || null,
      contentType: "EXPERT_INSIGHT",
      importedBy: req.admin?.name || req.admin?.email || req.admin?.uid || null,
      origin: "MANUAL_NEW_POST",
    });
    await opportunity.save();

    return res.json({ success: true, data: opportunity });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error("[ContentFactory] createManualOpportunity error:", err);
    return res.status(statusCode).json({ success: false, message: err.message || "Server error" });
  }
};
