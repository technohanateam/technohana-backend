import { importCompetitorBacklinkCsv } from "../services/backlinkCompetitorGapService.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

export const importCompetitorCsv = async (req, res) => {
  try {
    const { competitorName, rows } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 2000) {
      return res.status(400).json({ success: false, message: "rows must be a non-empty array (max 2000)" });
    }
    const summary = await importCompetitorBacklinkCsv({ rows, competitorName });
    await logSeoAudit(req, "competitor_gap.import", "SeoOpportunity", null, { competitorName, ...summary });
    return res.json({ success: true, message: "Import complete", data: summary });
  } catch (error) {
    console.error("Error importing competitor backlink CSV:", error);
    return res.status(500).json({ success: false, message: error.message || "Error importing CSV" });
  }
};
