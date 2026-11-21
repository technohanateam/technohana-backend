import { getExecSummary, getExecTrend, getExecDrilldown } from "../services/metricsService.js";
import { getSettlementReport, setCourseCost } from "../services/settlementService.js";
import { isValidId, parsePaging, sendCrmError } from "../utils/crmQuery.js";

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// Query values must be plain strings; objects (e.g. ?owner[$ne]=x) are dropped, never passed to Mongo.
const readParams = (q) => ({
  from: str(q.from),
  to: str(q.to),
  businessUnit: str(q.businessUnit),
  owner: isValidId(str(q.owner) || "") ? str(q.owner) : undefined,
  source: str(q.source),
  currency: str(q.currency),
  metric: str(q.metric),
});

const respond = (res, result, message) => {
  if (result.error) return res.status(400).json({ success: false, message: result.error });
  return res.json({ success: true, data: result, message });
};

export const execSummary = async (req, res) => {
  try {
    respond(res, await getExecSummary(readParams(req.query)), "Executive summary loaded");
  } catch (err) {
    sendCrmError(res, err, "Failed to load executive summary");
  }
};

export const execTrend = async (req, res) => {
  try {
    respond(res, await getExecTrend(readParams(req.query)), "Revenue trend loaded");
  } catch (err) {
    sendCrmError(res, err, "Failed to load revenue trend");
  }
};

export const execSettlement = async (req, res) => {
  try {
    respond(res, await getSettlementReport({ from: str(req.query.from), to: str(req.query.to) }), "Settlement report loaded");
  } catch (err) {
    sendCrmError(res, err, "Failed to load settlement report");
  }
};

export const execSetCourseCost = async (req, res) => {
  try {
    const { currency, courseTitle, costPerLearner } = req.body || {};
    const result = await setCourseCost({ courseId: req.params.courseId, currency: str(currency), courseTitle: str(courseTitle), costPerLearner }, req.admin._id);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.json({ success: true, data: result.data, message: "Course cost saved" });
  } catch (err) {
    sendCrmError(res, err, "Failed to save course cost");
  }
};

export const execDrilldown = async (req, res) => {
  try {
    const { page, limit } = parsePaging(req.query);
    respond(res, await getExecDrilldown(readParams(req.query), { page, limit }), "Records loaded");
  } catch (err) {
    sendCrmError(res, err, "Failed to load records");
  }
};
