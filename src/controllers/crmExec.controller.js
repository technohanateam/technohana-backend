import { getExecSummary, getExecTrend, getExecDrilldown } from "../services/metricsService.js";
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

export const execDrilldown = async (req, res) => {
  try {
    const { page, limit } = parsePaging(req.query);
    respond(res, await getExecDrilldown(readParams(req.query), { page, limit }), "Records loaded");
  } catch (err) {
    sendCrmError(res, err, "Failed to load records");
  }
};
