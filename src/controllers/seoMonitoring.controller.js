import SeoMonitoring from "../models/seoMonitoring.model.js";
import { buildMultiFieldRegexQuery } from "../utils/escapeRegex.js";

export const getMonitoring = async (req, res) => {
  try {
    const { search, linkStatus, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    const regexQuery = buildMultiFieldRegexQuery(search, ["website", "targetPage", "liveUrl"]);
    if (regexQuery) Object.assign(filter, regexQuery);
    if (linkStatus) filter.linkStatus = linkStatus;

    const total = await SeoMonitoring.countDocuments(filter);
    const data = await SeoMonitoring.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limitNum).lean();
    return res.json({ success: true, data, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) || 1 } });
  } catch (error) {
    console.error("Error fetching SEO monitoring records:", error);
    return res.status(500).json({ success: false, message: "Error fetching SEO monitoring records" });
  }
};

export const getPublishedLinks = async (req, res) => {
  req.query.linkStatus = "published";
  return getMonitoring(req, res);
};

export const createMonitoringRecord = async (req, res) => {
  try {
    const record = await SeoMonitoring.create(req.body);
    return res.status(201).json({ success: true, message: "Record created", data: record });
  } catch (error) {
    console.error("Error creating SEO monitoring record:", error);
    return res.status(500).json({ success: false, message: "Error creating SEO monitoring record" });
  }
};

const MONITORING_EDITABLE_FIELDS = [
  "website",
  "targetPage",
  "liveUrl",
  "anchor",
  "anchorText",
  "follow",
  "linkType",
  "publishedDate",
  "lastChecked",
  "notes",
  "linkStatus",
];

export const updateMonitoringRecord = async (req, res) => {
  try {
    const record = await SeoMonitoring.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });
    for (const field of MONITORING_EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) record[field] = req.body[field];
    }
    await record.save();
    return res.json({ success: true, message: "Record updated", data: record });
  } catch (error) {
    console.error("Error updating SEO monitoring record:", error);
    return res.status(500).json({ success: false, message: "Error updating SEO monitoring record" });
  }
};
