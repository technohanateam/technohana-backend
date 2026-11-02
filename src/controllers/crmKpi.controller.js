import KpiTarget, { KPI_METRICS } from "../models/crm/kpiTarget.model.js";
import { listKpis } from "../services/kpiService.js";
import { BUSINESS_UNITS } from "../constants/businessUnit.js";
import { isValidId, sendCrmError } from "../utils/crmQuery.js";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CURRENCIES = ["INR", "USD", "AED", "GBP", "EUR"];
const unitFor = (metric) => (metric.startsWith("revenue_") ? "money" : metric === "conversion_rate" ? "percent" : "count");

const currentPeriod = () => new Date().toISOString().slice(0, 7);

export const getKpis = async (req, res) => {
  try {
    const period = typeof req.query.period === "string" && PERIOD_RE.test(req.query.period) ? req.query.period : currentPeriod();
    const bu = req.query.businessUnit;
    if (bu !== undefined && !BUSINESS_UNITS.includes(bu)) return res.status(400).json({ success: false, message: "Invalid business unit" });
    const data = await listKpis({ period, businessUnit: bu });
    res.json({ success: true, data: { period, kpis: data }, message: "KPIs loaded" });
  } catch (err) {
    sendCrmError(res, err, "Failed to load KPIs");
  }
};

// Returns an error string, or the cleaned fields. `partial` allows omitting required fields on update.
export function cleanKpiBody(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has("label")) {
    if (typeof body.label !== "string" || !body.label.trim()) return { error: "Label is required" };
    out.label = body.label.trim().slice(0, 120);
  }
  if (!partial || has("metric")) {
    if (typeof body.metric !== "string" || !KPI_METRICS.includes(body.metric)) return { error: "Unknown metric" };
    out.metric = body.metric;
    out.unit = unitFor(body.metric);
  }
  if (!partial || has("period")) {
    if (typeof body.period !== "string" || !PERIOD_RE.test(body.period)) return { error: "Period must be YYYY-MM" };
    out.period = body.period;
  }
  if (has("businessUnit")) {
    if (body.businessUnit !== null && !BUSINESS_UNITS.includes(body.businessUnit)) return { error: "Invalid business unit" };
    out.businessUnit = body.businessUnit;
  }
  if (!partial || has("target")) {
    const t = body.target;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return { error: "Target must be a non-negative number" };
    // A target-only update doesn't know the metric's unit, so the whole-number rule applies when it is sent.
    if (out.unit && out.unit !== "percent" && !Number.isInteger(t)) return { error: "Money and count targets must be whole numbers (money in minor units)" };
    out.target = t;
  }
  if (has("currency")) {
    if (!CURRENCIES.includes(body.currency)) return { error: "Unsupported currency" };
    out.currency = body.currency;
  }
  if (has("owner")) {
    if (body.owner !== null && !(typeof body.owner === "string" && isValidId(body.owner))) return { error: "Invalid owner" };
    out.owner = body.owner;
  }
  if (has("notes")) out.notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : undefined;
  if (has("isActive")) out.isActive = body.isActive === true;
  return { fields: out };
}

export const createKpi = async (req, res) => {
  try {
    const { fields, error } = cleanKpiBody(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });
    const doc = await KpiTarget.create({ ...fields, updatedBy: req.admin._id });
    res.status(201).json({ success: true, data: doc, message: "KPI target created" });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ success: false, message: "A target for this metric, business unit and period already exists" });
    sendCrmError(res, err, "Failed to create KPI target");
  }
};

export const updateKpi = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { fields, error } = cleanKpiBody(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ success: false, message: error });
    const doc = await KpiTarget.findByIdAndUpdate(req.params.id, { $set: { ...fields, updatedBy: req.admin._id } }, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ success: false, message: "KPI target not found" });
    res.json({ success: true, data: doc, message: "KPI target updated" });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ success: false, message: "A target for this metric, business unit and period already exists" });
    sendCrmError(res, err, "Failed to update KPI target");
  }
};
