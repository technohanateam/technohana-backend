import {
  validateOpportunityData,
  checkDuplicateOpportunities,
  recomputeOpportunityScores,
  generateMonthlyReport as generateMonthlyReportService,
} from "../services/seoOpsScripts.service.js";

export const validateCsv = async (req, res) => {
  try {
    const result = await validateOpportunityData();
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error validating SEO opportunity data:", error);
    return res.status(500).json({ success: false, message: "Error running validation" });
  }
};

export const checkDuplicates = async (req, res) => {
  try {
    const result = await checkDuplicateOpportunities();
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error checking SEO opportunity duplicates:", error);
    return res.status(500).json({ success: false, message: "Error running duplicate check" });
  }
};

export const scoreOpportunities = async (req, res) => {
  try {
    const result = await recomputeOpportunityScores();
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error scoring SEO opportunities:", error);
    return res.status(500).json({ success: false, message: "Error running scoring" });
  }
};

export const generateMonthlyReport = async (req, res) => {
  try {
    const result = await generateMonthlyReportService();
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error generating SEO monthly report:", error);
    return res.status(500).json({ success: false, message: "Error generating report" });
  }
};
