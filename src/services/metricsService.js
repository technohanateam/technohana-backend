// Single source of truth for executive KPIs. Every figure is aggregated from stored records;
// nothing is estimated. Money is returned per currency in integer minor units — currencies are
// never converted or summed together.
//
// Revenue is reported three ways because the sources overlap:
//   collected  cash received through website checkouts (Order)
//   booked     value of CRM deals marked won, excluding deals that were closed by a website
//              order (those are already inside `collected`)
//   combined   collected + booked (no overlap)
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import "../models/crm/crmCompany.model.js"; // registers the schema the drill-down populates
import { Order } from "../models/order.model.js";
import CRMPipeline from "../models/crm/crmPipeline.model.js";
import { BUSINESS_UNITS, businessUnitForPipelineType } from "../constants/businessUnit.js";

const IST = "+05:30";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 400;
const isDateStr = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const istDate = (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

export const QUALIFIED_STATUSES = [
  "discovery", "needs_analysis", "skill_gap_assessed", "course_recommended",
  "demo_scheduled", "demo_done", "proposal_sent", "negotiation", "quotation_sent", "purchase_order",
  "payment_pending", "won", "enrolled",
];

// Not computable yet because the underlying records don't exist. Reported as unavailable
// instead of zero so nobody mistakes a gap for a result.
export const UNAVAILABLE_METRICS = [
  { key: "grossProfit", reason: "No expense or cost records yet (finance module not enabled)" },
  { key: "grossMargin", reason: "Needs cost records" },
  { key: "operatingExpenses", reason: "No expense records yet" },
  { key: "outstandingInvoices", reason: "No invoice records yet" },
  { key: "customerAcquisitionCost", reason: "Needs verified marketing spend per lead source" },
];

export function parseRange(fromStr, toStr, now = new Date()) {
  const to = isDateStr(toStr) ? toStr : istDate(now);
  const from = isDateStr(fromStr) ? fromStr : istDate(new Date(new Date(`${to}T00:00:00${IST}`).getTime() - 29 * DAY_MS));
  const start = new Date(`${from}T00:00:00${IST}`);
  const end = new Date(new Date(`${to}T00:00:00${IST}`).getTime() + DAY_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return { error: "Invalid date range" };
  if ((end - start) / DAY_MS > MAX_RANGE_DAYS) return { error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` };
  return { from, to, start, end };
}

export function buildFilters({ range, businessUnit, owner, source, currency }) {
  if (businessUnit && businessUnit !== "unassigned" && !BUSINESS_UNITS.includes(businessUnit)) return { error: "Invalid business unit" };
  const unit = businessUnit === "unassigned" ? { businessUnit: null } : businessUnit ? { businessUnit } : {};
  const s = range.start.getTime();
  const e = range.end.getTime();
  const ownerF = owner ? { assignedTo: owner } : {};
  // Currency only narrows money-bearing records; leads carry no currency. Orders store it in either case.
  const cur = typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency) ? currency : null;
  const dealCur = cur ? { currency: cur.toUpperCase() } : {};
  const orderCur = cur ? { currency: { $in: [cur.toLowerCase(), cur.toUpperCase()] } } : {};
  return {
    order: { status: "paid", paidAt: { $gte: s, $lt: e }, ...unit, ...orderCur },
    dealWon: { isDeleted: false, status: "won", wonAt: { $gte: range.start, $lt: range.end }, ...unit, ...ownerF, ...dealCur },
    dealOpen: { isDeleted: false, status: "open", ...unit, ...ownerF, ...dealCur },
    lead: {
      isDeleted: false, isDuplicate: { $ne: true }, createdAt: { $gte: range.start, $lt: range.end },
      ...unit, ...ownerF, ...(source ? { source } : {}),
    },
    // Orders carry no owner, so an owner or source filter hides order-based figures.
    ordersApply: !owner && !source,
  };
}

export function mergeCurrencyRows(...lists) {
  const byCur = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      const cur = row.currency || "INR";
      byCur.set(cur, (byCur.get(cur) || 0) + (row.amountMinor || 0));
    }
  }
  return [...byCur].map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => a.currency.localeCompare(b.currency));
}

const dealMinor = { $round: [{ $multiply: [{ $ifNull: ["$value", 0] }, 100] }, 0] };
const curOf = (field) => ({ $toUpper: { $ifNull: [field, "INR"] } });

const orderRevenue = async (match) => {
  const rows = await Order.aggregate([
    { $match: match },
    { $group: {
      _id: curOf("$currency"),
      amountMinor: { $sum: { $ifNull: ["$expectedTotalMinor", 0] } },
      orders: { $sum: 1 },
      enrolments: { $sum: { $ifNull: ["$participants", 1] } },
      customers: { $addToSet: { $toLower: { $ifNull: ["$learner.email", ""] } } },
    } },
  ]);
  const customers = new Set();
  rows.forEach((r) => r.customers.forEach((c) => c && customers.add(c)));
  return {
    byCurrency: rows.map((r) => ({ currency: r._id, amountMinor: r.amountMinor })),
    ordersByCurrency: rows.map((r) => ({ currency: r._id, count: r.orders })),
    learnersByCurrency: rows.map((r) => ({ currency: r._id, count: r.enrolments })),
    orders: rows.reduce((s, r) => s + r.orders, 0),
    enrolments: rows.reduce((s, r) => s + r.enrolments, 0),
    customers: customers.size,
  };
};

const dealSums = async (match) => {
  const rows = await CRMDeal.aggregate([
    { $match: match },
    { $group: {
      _id: curOf("$currency"),
      amountMinor: { $sum: dealMinor },
      weightedMinor: { $sum: { $round: [{ $multiply: [dealMinor, { $divide: [{ $ifNull: ["$probability", 0] }, 100] }] }, 0] } },
      count: { $sum: 1 },
      companies: { $addToSet: "$company" },
    } },
  ]);
  const companies = new Set();
  rows.forEach((r) => r.companies.forEach((c) => c && companies.add(String(c))));
  return {
    byCurrency: rows.map((r) => ({ currency: r._id, amountMinor: r.amountMinor })),
    weighted: rows.map((r) => ({ currency: r._id, amountMinor: r.weightedMinor })),
    average: rows.map((r) => ({ currency: r._id, amountMinor: r.count ? Math.round(r.amountMinor / r.count) : 0 })),
    count: rows.reduce((s, r) => s + r.count, 0),
    countByCurrency: rows.map((r) => ({ currency: r._id, count: r.count })),
    companies: companies.size,
  };
};

// Open deals per canonical stage. Stages that share an alias (legacy + newer) are merged, so one
// funnel reads the same whichever name a deal's stage has. Terminal stages never hold open deals.
export function buildFunnel(pipelines, rows, businessUnit) {
  const byStage = new Map();
  for (const r of rows) {
    const id = `${r._id.pipeline}|${r._id.stage}`;
    const cell = byStage.get(id) || { count: 0, byCurrency: new Map() };
    cell.count += r.count;
    cell.byCurrency.set(r._id.currency, (cell.byCurrency.get(r._id.currency) || 0) + r.amountMinor);
    byStage.set(id, cell);
  }

  return pipelines
    .map((p) => ({ p, unit: businessUnitForPipelineType(p.type) }))
    .filter(({ unit }) => !businessUnit || (businessUnit === "unassigned" ? unit === null : unit === businessUnit))
    .map(({ p, unit }) => {
      const groups = new Map();
      for (const s of p.stages.filter((x) => !x.isWon && !x.isLost).sort((a, b) => a.order - b.order)) {
        const alias = s.alias || s.key;
        const g = groups.get(alias) || { alias, label: s.label, count: 0, byCurrency: new Map() };
        const cell = byStage.get(`${p._id}|${s.key}`);
        if (cell) {
          g.count += cell.count;
          for (const [cur, amt] of cell.byCurrency) g.byCurrency.set(cur, (g.byCurrency.get(cur) || 0) + amt);
        }
        groups.set(alias, g);
      }
      return {
        pipelineId: String(p._id), name: p.name, type: p.type, businessUnit: unit,
        stages: [...groups.values()].map((g) => ({
          alias: g.alias, label: g.label, count: g.count,
          byCurrency: [...g.byCurrency].map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => a.currency.localeCompare(b.currency)),
        })),
      };
    });
}

const pipelineFunnel = async (dealOpenMatch, businessUnit) => {
  const [rows, pipelines] = await Promise.all([
    CRMDeal.aggregate([
      { $match: dealOpenMatch },
      { $group: { _id: { pipeline: "$pipeline", stage: "$stageKey", currency: curOf("$currency") }, count: { $sum: 1 }, amountMinor: { $sum: dealMinor } } },
    ]),
    CRMPipeline.find({ isActive: true }).select("name type stages").lean(),
  ]);
  return buildFunnel(pipelines, rows, businessUnit);
};

// Leads whose win came from a website order — their deal value is already in `collected`.
const orderSyncedLeadIds = () => CRMActivity.distinct("relatedToId", { type: "deal_won", "metadata.orderId": { $exists: true } });

export async function getExecSummary(params) {
  const range = parseRange(params.from, params.to);
  if (range.error) return range;
  const f = buildFilters({ ...params, range });
  if (f.error) return f;

  const syncedLeads = await orderSyncedLeadIds();
  const bookedMatch = syncedLeads.length ? { ...f.dealWon, lead: { $nin: syncedLeads } } : f.dealWon;

  const [orders, booked, open, leadStats, funnel] = await Promise.all([
    f.ordersApply ? orderRevenue(f.order) : { byCurrency: [], orders: 0, enrolments: 0, customers: 0, skipped: true },
    dealSums(bookedMatch),
    dealSums(f.dealOpen),
    CRMLead.aggregate([
      { $match: f.lead },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        qualified: { $sum: { $cond: [{ $in: ["$status", QUALIFIED_STATUSES] }, 1, 0] } },
        won: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] } },
      } },
    ]),
    pipelineFunnel(f.dealOpen, params.businessUnit),
  ]);

  const l = leadStats[0] || { total: 0, qualified: 0, won: 0, lost: 0 };
  const notes = [];
  if (orders.skipped) notes.push("Website orders have no owner or lead source, so they are excluded while an owner or source filter is active.");
  notes.push("Revenue in different currencies is never summed; each currency is shown separately.");
  notes.push("Booked revenue is contract value of won CRM deals, not cash received.");

  return {
    range: { from: range.from, to: range.to },
    filters: { businessUnit: params.businessUnit || "all", owner: params.owner || null, source: params.source || null },
    revenue: {
      collected: orders.byCurrency,
      booked: booked.byCurrency,
      combined: mergeCurrencyRows(orders.byCurrency, booked.byCurrency),
    },
    pipeline: { openValue: open.byCurrency, weightedValue: open.weighted, openDeals: open.count, openDealsByCurrency: open.countByCurrency, funnel },
    deals: { won: booked.count, wonByCurrency: booked.countByCurrency, averageValue: booked.average },
    leads: {
      created: l.total, qualified: l.qualified, won: l.won, lost: l.lost,
      conversionRate: l.total ? Math.round((l.won / l.total) * 1000) / 10 : null,
    },
    customers: { websiteBuyers: orders.customers, companiesWon: booked.companies },
    enrolments: { orders: orders.orders, learners: orders.enrolments, ordersByCurrency: orders.ordersByCurrency, learnersByCurrency: orders.learnersByCurrency },
    unavailable: UNAVAILABLE_METRICS,
    notes,
  };
}

export async function getExecTrend(params) {
  const range = parseRange(params.from, params.to);
  if (range.error) return range;
  const f = buildFilters({ ...params, range });
  if (f.error) return f;
  const tz = "Asia/Kolkata";
  const syncedLeads = await orderSyncedLeadIds();
  const bookedMatch = syncedLeads.length ? { ...f.dealWon, lead: { $nin: syncedLeads } } : f.dealWon;

  const [orders, deals] = await Promise.all([
    f.ordersApply
      ? Order.aggregate([
        { $match: f.order },
        { $group: {
          _id: { month: { $dateToString: { format: "%Y-%m", date: { $toDate: "$paidAt" }, timezone: tz } }, currency: curOf("$currency") },
          amountMinor: { $sum: { $ifNull: ["$expectedTotalMinor", 0] } },
        } },
      ])
      : [],
    CRMDeal.aggregate([
      { $match: bookedMatch },
      { $group: {
        _id: { month: { $dateToString: { format: "%Y-%m", date: "$wonAt", timezone: tz } }, currency: curOf("$currency") },
        amountMinor: { $sum: dealMinor },
      } },
    ]),
  ]);

  const rows = new Map();
  const put = (r, key) => {
    const id = `${r._id.month}|${r._id.currency}`;
    const row = rows.get(id) || { month: r._id.month, currency: r._id.currency, collectedMinor: 0, bookedMinor: 0 };
    row[key] += r.amountMinor;
    rows.set(id, row);
  };
  orders.forEach((r) => put(r, "collectedMinor"));
  deals.forEach((r) => put(r, "bookedMinor"));
  return { range: { from: range.from, to: range.to }, data: [...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency)) };
}

export const DRILLDOWN_METRICS = ["orders_collected", "deals_won", "pipeline_open", "leads_created", "leads_qualified"];

export async function getExecDrilldown(params, { page = 1, limit = 25 } = {}) {
  if (!DRILLDOWN_METRICS.includes(params.metric)) return { error: "Unknown metric" };
  const range = parseRange(params.from, params.to);
  if (range.error) return range;
  const f = buildFilters({ ...params, range });
  if (f.error) return f;
  const skip = (page - 1) * limit;
  const paged = (q) => q.skip(skip).limit(limit).lean();

  switch (params.metric) {
    case "orders_collected": {
      if (!f.ordersApply) return { items: [], total: 0 };
      const [items, total] = await Promise.all([
        paged(Order.find(f.order).select("orderId invoiceNumber currency expectedTotalMinor paidAt courseInfo.title learner.fullName learner.email businessUnit").sort({ paidAt: -1 })),
        Order.countDocuments(f.order),
      ]);
      return { items, total };
    }
    case "deals_won": {
      const syncedLeads = await orderSyncedLeadIds();
      const match = syncedLeads.length ? { ...f.dealWon, lead: { $nin: syncedLeads } } : f.dealWon;
      const [items, total] = await Promise.all([
        paged(CRMDeal.find(match).select("title value currency wonAt businessUnit company assignedTo").populate("company", "name").sort({ wonAt: -1 })),
        CRMDeal.countDocuments(match),
      ]);
      return { items, total };
    }
    case "pipeline_open": {
      const [items, total] = await Promise.all([
        paged(CRMDeal.find(f.dealOpen).select("title value currency probability stageKey expectedCloseDate businessUnit company assignedTo").populate("company", "name").sort({ value: -1 })),
        CRMDeal.countDocuments(f.dealOpen),
      ]);
      return { items, total };
    }
    default: {
      const match = params.metric === "leads_qualified" ? { ...f.lead, status: { $in: QUALIFIED_STATUSES } } : f.lead;
      const [items, total] = await Promise.all([
        paged(CRMLead.find(match).select("name company status source businessUnit createdAt assignedTo").sort({ createdAt: -1 })),
        CRMLead.countDocuments(match),
      ]);
      return { items, total };
    }
  }
}
