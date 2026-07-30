import SeoOpportunity from "../models/seoOpportunity.model.js";
import { buildMultiFieldRegexQuery } from "../utils/escapeRegex.js";

const SEARCH_FIELDS = [
  "competitor",
  "referringDomain",
  "organizationName",
  "opportunityType",
  "targetPage",
  "notes",
  "internalNotes",
];

const buildFilter = (query, recordTypeFilter) => {
  const { search, priority, status, confidence, evidenceLevel, discoverySource } = query;
  const filter = recordTypeFilter ? { recordType: recordTypeFilter } : {};
  const regexQuery = buildMultiFieldRegexQuery(search, SEARCH_FIELDS);
  if (regexQuery) Object.assign(filter, regexQuery);
  if (priority) filter.priority = priority;
  if (status) filter.status = status;
  if (confidence) filter.confidence = confidence;
  if (evidenceLevel) filter.evidenceLevel = evidenceLevel;
  if (discoverySource) filter.discoverySource = discoverySource;
  return filter;
};

const listOpportunities = (recordTypeFilter) => async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const filter = buildFilter(req.query, recordTypeFilter);
    const total = await SeoOpportunity.countDocuments(filter);
    // Sorting by the "priority" string directly is alphabetical (High, Low,
    // Medium) rather than by severity — compute a rank field to sort correctly.
    const data = await SeoOpportunity.aggregate([
      { $match: filter },
      {
        $addFields: {
          priorityRank: {
            $switch: {
              branches: [
                { case: { $eq: ["$priority", "High"] }, then: 0 },
                { case: { $eq: ["$priority", "Medium"] }, then: 1 },
                { case: { $eq: ["$priority", "Low"] }, then: 2 },
              ],
              default: 3,
            },
          },
        },
      },
      { $sort: { priorityRank: 1, overallScore: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
      { $project: { priorityRank: 0 } },
    ]);

    return res.json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) || 1 },
    });
  } catch (error) {
    console.error("Error fetching SEO opportunities:", error);
    return res.status(500).json({ success: false, message: "Error fetching SEO opportunities" });
  }
};

export const getAllOpportunities = listOpportunities();
export const getCompetitorGap = listOpportunities("competitor-gap");
export const getResourcePages = listOpportunities("resource-page");

export const getOpportunity = async (req, res) => {
  try {
    const opportunity = await SeoOpportunity.findById(req.params.id);
    if (!opportunity) {
      return res.status(404).json({ success: false, message: "Opportunity not found" });
    }
    return res.json({ success: true, data: opportunity });
  } catch (error) {
    console.error("Error fetching SEO opportunity:", error);
    return res.status(500).json({ success: false, message: "Error fetching SEO opportunity" });
  }
};

const EDITABLE_FIELDS = ["status", "assignedOwner", "internalNotes", "priority"];

export const updateOpportunity = async (req, res) => {
  try {
    const opportunity = await SeoOpportunity.findById(req.params.id);
    if (!opportunity) {
      return res.status(404).json({ success: false, message: "Opportunity not found" });
    }
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) opportunity[field] = req.body[field];
    }
    await opportunity.save();
    return res.json({ success: true, message: "Opportunity updated", data: opportunity });
  } catch (error) {
    console.error("Error updating SEO opportunity:", error);
    return res.status(500).json({ success: false, message: "Error updating SEO opportunity" });
  }
};

export const bulkUpdateOpportunities = async (req, res) => {
  try {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "ids array is required" });
    }
    const setFields = {};
    for (const field of EDITABLE_FIELDS) {
      if (updates?.[field] !== undefined) setFields[field] = updates[field];
    }
    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({ success: false, message: "No editable fields provided" });
    }
    const result = await SeoOpportunity.updateMany({ _id: { $in: ids } }, { $set: setFields });
    return res.json({ success: true, message: "Opportunities updated", data: { matched: result.matchedCount, modified: result.modifiedCount } });
  } catch (error) {
    console.error("Error bulk updating SEO opportunities:", error);
    return res.status(500).json({ success: false, message: "Error bulk updating SEO opportunities" });
  }
};

// Import: client parses CSV to a JSON array, matching the existing importLeads convention.
export const importOpportunities = async (req, res) => {
  try {
    const { recordType, rows } = req.body;
    if (!["priority-opportunity", "competitor-gap", "resource-page"].includes(recordType)) {
      return res.status(400).json({ success: false, message: "Invalid recordType" });
    }
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 1000) {
      return res.status(400).json({ success: false, message: "rows must be a non-empty array (max 1000)" });
    }

    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      const sourceKey =
        recordType === "resource-page"
          ? `resource-page:${row.resourcePageUrl}`
          : `${recordType}:import:${row.competitor}|${row.referringDomain}|${row.opportunityType}`;
      const existing = await SeoOpportunity.findOne({ sourceKey });
      if (existing) {
        skipped++;
        continue;
      }
      await SeoOpportunity.create({ ...row, recordType, sourceKey, status: "new" });
      imported++;
    }

    return res.json({ success: true, message: "Import complete", data: { imported, skipped } });
  } catch (error) {
    console.error("Error importing SEO opportunities:", error);
    return res.status(500).json({ success: false, message: "Error importing SEO opportunities" });
  }
};
