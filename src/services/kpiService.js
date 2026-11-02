import KpiTarget from "../models/crm/kpiTarget.model.js";
import { getExecSummary } from "./metricsService.js";

const moneyFor = (rows, currency) => rows.find((r) => r.currency === currency)?.amountMinor ?? 0;

// How to read each metric out of an exec summary.
const READERS = {
  revenue_collected: (s, t) => moneyFor(s.revenue.collected, t.currency),
  revenue_booked: (s, t) => moneyFor(s.revenue.booked, t.currency),
  revenue_combined: (s, t) => moneyFor(s.revenue.combined, t.currency),
  leads_created: (s) => s.leads.created,
  leads_qualified: (s) => s.leads.qualified,
  deals_won: (s) => s.deals.won,
  enrolments: (s) => s.enrolments.learners,
  conversion_rate: (s) => s.leads.conversionRate,
};

export function periodBounds(period) {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, "0");
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

export function previousPeriod(period) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Share of the period elapsed at `now` (0..1), by calendar days in UTC.
export function elapsedFraction(period, now = new Date()) {
  const { from, to } = periodBounds(period);
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime() + 86400000;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

export function evaluateKpi(target, actual, previousActual, now = new Date()) {
  if (actual == null) {
    return { actual: null, variance: null, attainmentPct: null, status: "no_data", trend: "unknown" };
  }
  const attainmentPct = target.target > 0 ? Math.round((actual / target.target) * 1000) / 10 : null;
  // Rates are judged against the full target; counts and money are paced across the period.
  const pace = target.unit === "percent" ? 1 : elapsedFraction(target.period, now);
  let status = "behind";
  if (attainmentPct == null) status = "no_data";
  else if (attainmentPct >= 100) status = "achieved";
  else if (attainmentPct >= pace * 100 * 0.9) status = "on_track";
  const trend = previousActual == null ? "unknown" : actual > previousActual ? "up" : actual < previousActual ? "down" : "flat";
  // Rates are fractional, so round the subtraction (16.7 - 15 is 1.6999999999999993 in floats).
  const variance = Math.round((actual - target.target) * 10) / 10;
  return { actual, variance, attainmentPct, status, trend };
}

export async function listKpis({ period, businessUnit }, now = new Date()) {
  const filter = { isActive: true, period, ...(businessUnit ? { businessUnit } : {}) };
  const targets = await KpiTarget.find(filter).sort({ businessUnit: 1, metric: 1 }).populate("owner", "name").lean();

  const cache = new Map();
  const summaryFor = (p, unit) => {
    const key = `${p}|${unit || "all"}`;
    if (!cache.has(key)) cache.set(key, getExecSummary({ ...periodBounds(p), businessUnit: unit || undefined }));
    return cache.get(key);
  };

  return Promise.all(targets.map(async (t) => {
    const read = READERS[t.metric];
    const [cur, prev] = await Promise.all([summaryFor(t.period, t.businessUnit), summaryFor(previousPeriod(t.period), t.businessUnit)]);
    const evaluation = evaluateKpi(t, cur.error ? null : read(cur, t), prev.error ? null : read(prev, t), now);
    return {
      ...t,
      ...evaluation,
      dataSource: `metricsService:${t.metric}`,
      isPlan: t.isPlan,
    };
  }));
}
