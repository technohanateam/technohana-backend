import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMTask from "../models/crm/crmTask.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CrmUser from "../models/crmUser.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { crmDailyReportEmail } from "../utils/emailTemplate.js";

// All CRM reporting days are IST calendar days (no DST, fixed +05:30 offset).
export const REPORT_TZ = "Asia/Kolkata";
const IST_OFFSET = "+05:30";
const MAX_RANGE_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_TYPES = ["call", "email", "meeting", "whatsapp", "note"];

const isDateStr = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const istDateStr = (date = new Date()) =>
  new Date(date.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Inclusive [fromStr, toStr] IST dates -> half-open UTC range.
export function resolveRange(fromStr, toStr) {
  const today = istDateStr();
  const from = isDateStr(fromStr) ? fromStr : today;
  const to = isDateStr(toStr) ? toStr : from;
  const start = new Date(`${from}T00:00:00${IST_OFFSET}`);
  const end = new Date(new Date(`${to}T00:00:00${IST_OFFSET}`).getTime() + DAY_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { error: "Invalid date range" };
  }
  if ((end - start) / DAY_MS > MAX_RANGE_DAYS) {
    return { error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` };
  }
  return { from, to, start, end };
}

const EMPTY_ROW = () => ({
  leadsCreated: 0, leadsWon: 0,
  calls: 0, emails: 0, meetings: 0, whatsapp: 0, notes: 0,
  dealsCreated: 0, dealsWon: 0, dealsLost: 0, revenueWon: 0,
  tasksCompleted: 0, tasksOverdue: 0,
});

// repId: restrict to one rep (used for non-admin roles); omit for the whole team.
export async function buildDailyReport({ from, to, repId = null }) {
  const range = resolveRange(from, to);
  if (range.error) return range;
  const { start, end } = range;

  const inRange = (field) => ({ [field]: { $gte: start, $lt: end } });
  const scope = (field) => (repId ? { [field]: repId } : {});
  const dayKey = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: `$${field}`, timezone: REPORT_TZ } });

  const [
    leadsCreated, leadsWon, activities, dealsCreated, dealsWon, dealsLost,
    tasksCompleted, tasksOverdue, sources, leadsByDay, activitiesByDay, dealsByDay,
  ] = await Promise.all([
    CRMLead.aggregate([{ $match: { isDeleted: false, ...inRange("createdAt"), ...scope("assignedTo") } }, { $group: { _id: "$assignedTo", n: { $sum: 1 } } }]),
    CRMLead.aggregate([{ $match: { isDeleted: false, ...inRange("wonAt"), ...scope("assignedTo") } }, { $group: { _id: "$assignedTo", n: { $sum: 1 } } }]),
    CRMActivity.aggregate([
      { $match: { type: { $in: ACTIVITY_TYPES }, ...inRange("createdAt"), ...scope("performedBy") } },
      { $group: { _id: { rep: "$performedBy", type: "$type" }, n: { $sum: 1 } } },
    ]),
    CRMDeal.aggregate([{ $match: { isDeleted: false, ...inRange("createdAt"), ...scope("assignedTo") } }, { $group: { _id: "$assignedTo", n: { $sum: 1 } } }]),
    CRMDeal.aggregate([{ $match: { isDeleted: false, status: "won", ...inRange("wonAt"), ...scope("assignedTo") } }, { $group: { _id: "$assignedTo", n: { $sum: 1 }, value: { $sum: "$value" } } }]),
    CRMDeal.aggregate([{ $match: { isDeleted: false, status: "lost", ...inRange("lostAt"), ...scope("assignedTo") } }, { $group: { _id: "$assignedTo", n: { $sum: 1 } } }]),
    CRMTask.aggregate([{ $match: { isDeleted: false, status: "done", ...inRange("completedAt"), ...scope("assignedTo") } }, { $group: { _id: "$assignedTo", n: { $sum: 1 } } }]),
    CRMTask.aggregate([{ $match: { isDeleted: false, status: { $in: ["open", "in_progress"] }, dueDate: { $lt: new Date() }, ...scope("assignedTo") } }, { $group: { _id: "$assignedTo", n: { $sum: 1 } } }]),
    CRMLead.aggregate([{ $match: { isDeleted: false, ...inRange("createdAt"), ...scope("assignedTo") } }, { $group: { _id: "$source", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    CRMLead.aggregate([{ $match: { isDeleted: false, ...inRange("createdAt"), ...scope("assignedTo") } }, { $group: { _id: dayKey("createdAt"), n: { $sum: 1 } } }]),
    CRMActivity.aggregate([{ $match: { type: { $in: ACTIVITY_TYPES }, ...inRange("createdAt"), ...scope("performedBy") } }, { $group: { _id: dayKey("createdAt"), n: { $sum: 1 } } }]),
    CRMDeal.aggregate([{ $match: { isDeleted: false, status: "won", ...inRange("wonAt"), ...scope("assignedTo") } }, { $group: { _id: dayKey("wonAt"), n: { $sum: 1 }, value: { $sum: "$value" } } }]),
  ]);

  const rows = new Map();
  const row = (id) => {
    const key = id ? String(id) : "unassigned";
    if (!rows.has(key)) rows.set(key, { repId: key, ...EMPTY_ROW() });
    return rows.get(key);
  };

  leadsCreated.forEach((r) => { row(r._id).leadsCreated = r.n; });
  leadsWon.forEach((r) => { row(r._id).leadsWon = r.n; });
  dealsCreated.forEach((r) => { row(r._id).dealsCreated = r.n; });
  dealsWon.forEach((r) => { const x = row(r._id); x.dealsWon = r.n; x.revenueWon = r.value; });
  dealsLost.forEach((r) => { row(r._id).dealsLost = r.n; });
  tasksCompleted.forEach((r) => { row(r._id).tasksCompleted = r.n; });
  tasksOverdue.forEach((r) => { row(r._id).tasksOverdue = r.n; });
  const activityField = { call: "calls", email: "emails", meeting: "meetings", whatsapp: "whatsapp", note: "notes" };
  activities.forEach((r) => { row(r._id.rep)[activityField[r._id.type]] = r.n; });

  const realIds = [...rows.keys()].filter((k) => k !== "unassigned");
  const users = realIds.length ? await CrmUser.find({ _id: { $in: realIds } }).select("name").lean() : [];
  const names = new Map(users.map((u) => [String(u._id), u.name]));

  const reps = [...rows.values()]
    .map((r) => ({
      ...r,
      repName: r.repId === "unassigned" ? "Unassigned" : names.get(r.repId) || "Former team member",
      activityTotal: r.calls + r.emails + r.meetings + r.whatsapp + r.notes,
    }))
    .sort((a, b) => (b.activityTotal + b.dealsWon + b.leadsCreated) - (a.activityTotal + a.dealsWon + a.leadsCreated));

  const totals = reps.reduce((t, r) => {
    Object.keys(EMPTY_ROW()).forEach((k) => { t[k] += r[k]; });
    t.activityTotal += r.activityTotal;
    return t;
  }, { ...EMPTY_ROW(), activityTotal: 0 });

  // Continuous day series so charts show zero-days too.
  const lMap = new Map(leadsByDay.map((d) => [d._id, d.n]));
  const aMap = new Map(activitiesByDay.map((d) => [d._id, d.n]));
  const dMap = new Map(dealsByDay.map((d) => [d._id, d]));
  const byDay = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
    const d = istDateStr(new Date(t));
    byDay.push({ date: d, leads: lMap.get(d) || 0, activities: aMap.get(d) || 0, dealsWon: dMap.get(d)?.n || 0, revenue: dMap.get(d)?.value || 0 });
  }

  return {
    from: range.from,
    to: range.to,
    timezone: REPORT_TZ,
    totals,
    reps,
    sources: sources.map((s) => ({ source: s._id || "unknown", count: s.n })),
    byDay,
  };
}

export async function getDailyReportRecipients() {
  const admins = await CrmUser.find({ active: true, crmRole: { $in: ["super_admin", "admin"] } }).select("email").lean();
  const extra = (process.env.CRM_DAILY_REPORT_EXTRA_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  return [...new Set([...admins.map((a) => a.email), ...extra])];
}

export async function sendDailyReportEmail({ date = istDateStr(), to } = {}) {
  const report = await buildDailyReport({ from: date, to: date });
  if (report.error) throw new Error(report.error);

  const recipients = to?.length ? to : await getDailyReportRecipients();
  if (!recipients.length) return { sent: 0, report };

  const dashboardUrl = process.env.CRM_FRONTEND_URL || "https://crm.technohana.in";
  await sendEmail({
    from: fromAddresses.sales,
    to: recipients,
    subject: `CRM Daily Report — ${date}`,
    html: crmDailyReportEmail({ report, dashboardUrl: `${dashboardUrl}/analytics` }),
  });
  return { sent: recipients.length, report };
}
