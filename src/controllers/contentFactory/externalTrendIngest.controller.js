import { buildOpportunityFromImport } from "../../services/contentFactory/articleImport.service.js";
import { CONTENT_TYPES } from "../../models/contentOpportunity.model.js";

// POST /admin/content-factory-external/import/external-trend
//
// Called by the unattended weekly trend-research cloud routine (not an
// interactive admin) — see externalTrendIngest.middleware.js for auth.
// Accepts an array of pre-scored trend opportunities and creates one
// ContentOpportunity per trend, landing in Human Review same as every other
// import path (buildOpportunityFromImport always sets HUMAN_REVIEW).
export const ingestExternalTrends = async (req, res) => {
  try {
    const { trends } = req.body || {};
    if (!Array.isArray(trends) || trends.length === 0) {
      return res.status(400).json({ success: false, message: "trends must be a non-empty array." });
    }

    const created = [];
    for (const trend of trends) {
      const { title, summary, whyItMatters, technohanaAngle, format, audience, priority, sources, trendScore, overallScore, category, contentType } = trend || {};
      if (!title) continue;

      const resolvedContentType = CONTENT_TYPES.includes(contentType) ? contentType : "TRENDING";
      const recommendationReason = [whyItMatters, technohanaAngle].filter(Boolean).join(" ") || null;

      const opportunity = await buildOpportunityFromImport({
        articleDraft: { title, content: summary || "" },
        category: category || null,
        contentType: resolvedContentType,
        origin: "EXTERNAL_TREND_AGENT",
        trendScore: Number(trendScore) || 0,
        overallScore: Number(overallScore) || 0,
        topicAngle: technohanaAngle || null,
        recommendationReason,
        extraSourceInfo: { sources: Array.isArray(sources) ? sources : [], format: format || null, audience: audience || null, priority: priority || null },
      });
      await opportunity.save();
      created.push(opportunity);
    }

    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error("[ContentFactory] ingestExternalTrends error:", err);
    return res.status(statusCode).json({ success: false, message: err.message || "Server error" });
  }
};
