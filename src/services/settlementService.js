// Settlement report for paid-ad leads: what the ad team's leads brought in, Technohana's trainer cost,
// the real ad spend, and what is left. Every figure comes from stored records or the Meta API;
// anything that cannot be known is returned as null and explained in `notes`, never estimated.
// Money is integer minor units per currency; currencies are never converted or summed together.
//
// Timing: revenue counts in the period its 7-day refund window ends (paid + 7 days); orders still
// inside the window are reported as holding. Trainer cost counts in the period the learner's batch
// was delivered (batch completed, by its end date), using the per-learner cost an admin set for the
// course. Learners with no delivered batch yet are listed as pending. Technohana's overhead is a
// percentage of cleared revenue (SETTLEMENT_OVERHEAD_PERCENT); until it is set, overhead and net
// are not calculated.
import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import SettlementCourseCost from "../models/crm/settlementCourseCost.model.js";
import Batch from "../models/batch.model.js";
import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";
import { parseRange } from "./metricsService.js";
import { AD_POOL_QUERY } from "./crmLeadIntake.js";
import { getAdPerformance } from "./metaAdInsights.js";

const META_UTM = /^(instagram|ig|facebook|fb|meta)\b/i;
const GROUPS = {
  meta: "Meta (Facebook / Instagram)",
  google: "Google Ads",
  linkedin: "LinkedIn Ads",
};

export const groupOf = ({ source, utm } = {}) => {
  if (source === "meta_ads" || (source === "social" && META_UTM.test(String(utm?.utm_source || "")))) return "meta";
  if (source === "google_ads") return "google";
  if (source === "linkedin_ads") return "linkedin";
  return null;
};

const REFUND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const cur = (c) => String(c || "INR").toUpperCase();
const costKey = (courseId, currency) => `${courseId}|${currency}`;

const overheadPercentFrom = (env) => {
  const raw = env.SETTLEMENT_OVERHEAD_PERCENT;
  if (raw === undefined || raw === null || String(raw).trim() === "") return { percent: null };
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? { percent: n } : { percent: null, invalid: true };
};

// The pay day (default the 10th) of the month after the period ends, as YYYY-MM-DD.
export const settlementDueDate = (to, env = process.env) => {
  const [y, m] = to.split("-").map(Number);
  const day = Number(env.SETTLEMENT_PAY_DAY);
  const payDay = Number.isInteger(day) && day >= 1 && day <= 28 ? day : 10;
  return new Date(Date.UTC(y, m, payDay)).toISOString().slice(0, 10);
};

export async function setCourseCost({ courseId, currency, courseTitle, costPerLearner }, userId) {
  const id = String(courseId || "").trim();
  const amount = Number(costPerLearner);
  if (!id) return { error: "courseId is required" };
  if (!/^[A-Za-z]{3}$/.test(String(currency || ""))) return { error: "currency must be a 3-letter code" };
  if (!Number.isFinite(amount) || amount < 0) return { error: "Cost per learner must be zero or more" };
  const doc = await SettlementCourseCost.findOneAndUpdate(
    { courseId: id, currency: cur(currency) },
    { $set: { costPerLearnerMinor: Math.round(amount * 100), updatedBy: userId, ...(courseTitle ? { courseTitle: String(courseTitle).slice(0, 200) } : {}) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return { data: doc };
}

export async function getSettlementReport(params = {}, { adPerformance = getAdPerformance, env = process.env } = {}) {
  const range = parseRange(params.from, params.to);
  if (range.error) return { error: range.error };
  const overhead = overheadPercentFrom(env);
  const start = range.start.getTime();
  const end = range.end.getTime();

  // Every paid-ad lead that could have produced an order up to the end of the period.
  const leads = await CRMLead.find({
    isDeleted: false, isDuplicate: { $ne: true }, ...AD_POOL_QUERY,
    email: { $nin: [null, ""] }, createdAt: { $lt: range.end },
  }).select("email source utm createdAt").lean();

  const byEmail = new Map();
  for (const l of leads) {
    const group = groupOf(l);
    const email = String(l.email).toLowerCase().trim();
    const known = byEmail.get(email);
    if (group && (!known || new Date(l.createdAt) < known.createdAt)) byEmail.set(email, { group, createdAt: new Date(l.createdAt), leadId: l._id });
  }

  // Ad-lead orders paid up to the end of the period (earlier ones can still have cost landing now).
  const allOrders = await Order.find({ status: "paid", paidAt: { $lt: end } })
    .select("orderId courseId courseInfo.title currency expectedTotalMinor participants learner.email paidAt").lean();
  const adOrders = [];
  for (const o of allOrders) {
    const email = String(o.learner?.email || "").toLowerCase().trim();
    const lead = byEmail.get(email);
    if (lead && o.paidAt >= lead.createdAt.getTime()) adOrders.push({ ...o, email, group: lead.group, learners: o.participants || 1 });
  }

  const table = new Map(); // `${group}|${currency}` -> row
  const bucket = (group, currency) => {
    const key = `${group}|${currency}`;
    if (!table.has(key)) {
      table.set(key, {
        group, currency, orders: 0, enrolments: 0, collectedMinor: 0, holdingOrders: 0, holdingMinor: 0,
        overheadMinor: null, costMinor: 0, costLearners: 0, costMissingLearners: 0, pendingLearners: 0, pendingCostMinor: 0,
        spendMinor: null, netMinor: null,
      });
    }
    return table.get(key);
  };

  const costs = new Map((await SettlementCourseCost.find({}).lean()).map((c) => [costKey(c.courseId, c.currency), c]));

  // Where each order's learners are being taught: orderId -> their batch.
  const orderIds = adOrders.map((o) => o.orderId);
  const enrolments = orderIds.length ? await User.find({ orderId: { $in: orderIds }, batchId: { $exists: true, $ne: null } }).select("orderId batchId").lean() : [];
  const batchIds = [...new Set(enrolments.map((e) => String(e.batchId)))];
  const batches = batchIds.length ? await Batch.find({ _id: { $in: batchIds } }).select("status endDate").lean() : [];
  const batchById = new Map(batches.map((b) => [String(b._id), b]));
  const batchOfOrder = new Map(enrolments.map((e) => [e.orderId, batchById.get(String(e.batchId))]));

  const courses = new Map(); // costKey -> course row for the cost editor
  const missingCourses = new Set();
  const paidEmails = new Set();
  for (const o of adOrders) {
    const currency = cur(o.currency);
    const row = bucket(o.group, currency);
    const key = costKey(o.courseId, currency);
    const set = costs.get(key);
    const course = courses.get(key) || { courseId: String(o.courseId || ""), title: o.courseInfo?.title || String(o.courseId || ""), currency, costPerLearnerMinor: set ? set.costPerLearnerMinor : null, learners: 0 };
    course.learners += o.learners;
    courses.set(key, course);

    paidEmails.add(o.email);
    const clearsAt = o.paidAt + REFUND_WINDOW_MS;
    if (clearsAt >= start && clearsAt < end) {
      row.orders += 1;
      row.enrolments += o.learners;
      row.collectedMinor += o.expectedTotalMinor || 0;
    } else if (clearsAt >= end) {
      row.holdingOrders += 1;
      row.holdingMinor += o.expectedTotalMinor || 0;
    }

    // Cost: recognised when the learner's batch is completed, by its end date.
    const batch = batchOfOrder.get(o.orderId);
    const deliveredAt = batch?.status === "completed" && batch.endDate ? new Date(batch.endDate).getTime() : null;
    if (deliveredAt !== null && deliveredAt >= start && deliveredAt < end) {
      if (set) {
        row.costMinor += set.costPerLearnerMinor * o.learners;
        row.costLearners += o.learners;
      } else {
        row.costMissingLearners += o.learners;
        missingCourses.add(key);
      }
    } else if (deliveredAt === null || deliveredAt >= end) {
      row.pendingLearners += o.learners;
      if (set) row.pendingCostMinor += set.costPerLearnerMinor * o.learners;
      else missingCourses.add(key);
    }
  }

  const notes = ["Refunds and chargebacks are not recorded in the system yet, so they are not deducted."];
  let metaSpend = null;
  let metaCurrency = null;
  try {
    const perf = await adPerformance({ since: range.from, until: range.to });
    if (perf?.configured && perf.totals?.spend != null) {
      metaCurrency = cur(perf.currency);
      metaSpend = Math.round(perf.totals.spend * 100);
      bucket("meta", metaCurrency);
    } else {
      notes.push("Meta ad spend is unavailable (Marketing API is not configured), so Meta net is not calculated.");
    }
  } catch (err) {
    console.error("[settlement] Meta spend failed:", err.message);
    notes.push("Meta ad spend could not be fetched, so Meta net is not calculated.");
  }

  for (const row of table.values()) {
    if (row.group === "meta" && metaSpend != null && row.currency === metaCurrency) row.spendMinor = metaSpend;
    if (overhead.percent !== null) row.overheadMinor = Math.round(row.collectedMinor * overhead.percent / 100);
    if (row.costMissingLearners > 0) row.costMinor = null;
    if (row.costMinor != null && row.overheadMinor != null && row.spendMinor != null) {
      row.netMinor = row.collectedMinor - row.costMinor - row.overheadMinor - row.spendMinor;
    }
  }
  notes.unshift("Revenue counts once its 7-day refund window has passed; orders still inside the window are shown as holding and are not in net.");
  if (overhead.invalid) notes.push("SETTLEMENT_OVERHEAD_PERCENT is not a number between 0 and 100, so overhead and net are not calculated.");
  else if (overhead.percent === null) notes.push("Technohana's overhead percentage is not set (SETTLEMENT_OVERHEAD_PERCENT), so overhead and net are not calculated.");
  if ([...table.values()].some((r) => r.costMissingLearners > 0)) {
    notes.push("Some delivered learners are on a course with no trainer cost set, so their row's cost and net are not calculated. Set the cost for the courses listed below.");
  }
  if ([...table.values()].some((r) => r.pendingLearners > 0)) {
    notes.push("Pending learners have paid but their batch is not delivered yet (or they are not in a batch). Their trainer cost is not in this period; the expected amount is shown for information.");
  }
  if (metaSpend != null && [...table.values()].some((r) => r.group === "meta" && r.currency !== metaCurrency && r.collectedMinor)) {
    notes.push(`Meta spend is in ${metaCurrency} and is not converted, so Meta revenue in other currencies has no net.`);
  }
  if ([...table.values()].some((r) => r.group !== "meta" && r.collectedMinor)) {
    notes.push("Google and LinkedIn ad spend is not recorded yet, so their net is not calculated.");
  }

  // Won CRM deals from ad leads that have no website order (contract value, not cash).
  const leadIds = [...byEmail.entries()].filter(([email]) => !paidEmails.has(email)).map(([, v]) => v.leadId);
  const deals = leadIds.length ? await CRMDeal.find({
    isDeleted: false, status: "won", wonAt: { $gte: range.start, $lt: range.end }, lead: { $in: leadIds },
  }).select("value currency").lean() : [];
  const booked = new Map();
  for (const d of deals) {
    const c = cur(d.currency);
    const b = booked.get(c) || { currency: c, amountMinor: 0, count: 0 };
    b.amountMinor += Math.round((d.value || 0) * 100);
    b.count += 1;
    booked.set(c, b);
  }

  const groups = Object.entries(GROUPS).map(([key, label]) => ({
    key,
    label,
    spendRecorded: key === "meta" && metaSpend != null,
    currencies: [...table.values()].filter((r) => r.group === key).map(({ group, ...r }) => r).sort((a, b) => a.currency.localeCompare(b.currency)),
  }));

  // Totals add only rows whose net is known, so a partly unknown total is never passed off as complete.
  const totals = new Map();
  let complete = true;
  for (const row of table.values()) {
    if (row.netMinor == null) { if (row.collectedMinor || row.spendMinor || row.costLearners) complete = false; continue; }
    const t = totals.get(row.currency) || { currency: row.currency, collectedMinor: 0, costMinor: 0, overheadMinor: 0, spendMinor: 0, netMinor: 0 };
    t.collectedMinor += row.collectedMinor; t.costMinor += row.costMinor; t.overheadMinor += row.overheadMinor;
    t.spendMinor += row.spendMinor; t.netMinor += row.netMinor;
    totals.set(row.currency, t);
  }

  return {
    range: { from: range.from, to: range.to },
    settlementDueDate: settlementDueDate(range.to, env),
    overheadPercent: overhead.percent,
    groups,
    totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    totalsComplete: complete,
    courses: [...courses.values()].map((c) => ({ ...c, missing: missingCourses.has(costKey(c.courseId, c.currency)) }))
      .sort((a, b) => Number(b.missing) - Number(a.missing) || a.title.localeCompare(b.title)),
    bookedNotCollected: [...booked.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    notes,
  };
}
