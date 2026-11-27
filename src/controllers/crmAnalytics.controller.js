import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMTask from "../models/crm/crmTask.model.js";
import "../models/crm/crmTag.model.js";
import CrmUser from "../models/crmUser.model.js";
import { buildDailyReport, sendDailyReportEmail, resolveRange, istDateStr, istMonthStart, REPORT_TZ } from "../services/crmDailyReport.js";
import { ownerFilter, isValidId } from "../utils/crmQuery.js";

const wonAtPart = (op) => ({ [op]: { date: "$wonAt", timezone: REPORT_TZ } });

// Each period buckets won deals into IST weeks (12), quarters (4) or months (12).
const REVENUE_PERIODS = {
  week: {
    key: { $dateToString: { format: "%G-W%V", date: "$wonAt", timezone: REPORT_TZ } },
    cutoff: () => new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000),
  },
  quarter: {
    key: { $concat: [
      { $toString: wonAtPart("$year") },
      "-Q",
      { $toString: { $toInt: { $ceil: { $divide: [wonAtPart("$month"), 3] } } } },
    ] },
    cutoff: () => {
      const month = Number(istDateStr().slice(5, 7));
      return istMonthStart(((month - 1) % 3) + 9);
    },
  },
  month: {
    key: { $dateToString: { format: "%Y-%m", date: "$wonAt", timezone: REPORT_TZ } },
    cutoff: () => istMonthStart(11),
  },
};

export const getRevenueTrend = async (req, res) => {
  try {
    const period = Object.hasOwn(REVENUE_PERIODS, req.query.period) ? req.query.period : "month";
    const { key: dateFormat, cutoff: cutoffFn } = REVENUE_PERIODS[period];
    const cutoff = cutoffFn();

    const result = await CRMDeal.aggregate([
      {
        $match: {
          isDeleted: false,
          status: "won",
          wonAt: { $gte: cutoff },
          ...ownerFilter(req),
        },
      },
      {
        $group: {
          _id: dateFormat,
          revenue: { $sum: "$value" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({ success: true, data: result, message: "Revenue trend loaded" });
  } catch (err) {
    console.error("getRevenueTrend error:", err);
    res.status(500).json({ success: false, message: "Failed to load revenue trend" });
  }
};

export const getRepStats = async (req, res) => {
  try {
    const matchFilter = { isDeleted: false, ...ownerFilter(req) };

    const [leadStats, dealStats] = await Promise.all([
      CRMLead.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: "$assignedTo",
            total: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
            hot: { $sum: { $cond: [{ $eq: ["$aiScoreBand", "hot"] }, 1, 0] } },
            new: { $sum: { $cond: [{ $eq: ["$status", "new"] }, 1, 0] } },
          },
        },
        {
          $lookup: {
            from: "crmusers",
            localField: "_id",
            foreignField: "_id",
            as: "rep",
          },
        },
        { $unwind: { path: "$rep", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            repId: "$_id",
            repName: { $ifNull: ["$rep.name", "Unassigned"] },
            total: 1,
            won: 1,
            hot: 1,
            new: 1,
            conversionRate: {
              $cond: [
                { $gt: ["$total", 0] },
                { $multiply: [{ $divide: ["$won", "$total"] }, 100] },
                0,
              ],
            },
          },
        },
        { $sort: { total: -1 } },
      ]),

      CRMDeal.aggregate([
        {
          $match: {
            isDeleted: false,
            ...ownerFilter(req),
          },
        },
        {
          $group: {
            _id: "$assignedTo",
            openValue: {
              $sum: { $cond: [{ $eq: ["$status", "open"] }, "$value", 0] },
            },
            wonValue: {
              $sum: { $cond: [{ $eq: ["$status", "won"] }, "$value", 0] },
            },
          },
        },
      ]),
    ]);

    // Merge deal stats into lead stats by rep ID
    const dealMap = {};
    for (const d of dealStats) {
      dealMap[String(d._id)] = { openValue: d.openValue, wonValue: d.wonValue };
    }

    const merged = leadStats.map((r) => ({
      ...r,
      ...(dealMap[String(r.repId)] || { openValue: 0, wonValue: 0 }),
    }));

    res.json({ success: true, data: merged, message: "Rep stats loaded" });
  } catch (err) {
    console.error("getRepStats error:", err);
    res.status(500).json({ success: false, message: "Failed to load rep stats" });
  }
};

export const getConversionStats = async (req, res) => {
  try {
    const assignedFilter = ownerFilter(req);

    const STATUS_ORDER = [
      "new", "contacted", "discovery", "needs_analysis", "skill_gap_assessed",
      "course_recommended", "demo_scheduled", "demo_done", "proposal_sent", "negotiation",
      "quotation_sent", "purchase_order", "payment_pending", "won", "enrolled",
    ];

    const raw = await CRMLead.aggregate([
      { $match: { isDeleted: false, ...assignedFilter } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const countMap = {};
    for (const r of raw) countMap[r._id] = r.count;

    const funnel = STATUS_ORDER.map((s) => ({ status: s, count: countMap[s] || 0 }));

    // Calculate stage-to-stage conversion rates
    const withRates = funnel.map((item, i) => ({
      ...item,
      conversionFromPrev: i === 0 || funnel[i - 1].count === 0
        ? null
        : Math.round((item.count / funnel[i - 1].count) * 100),
    }));

    res.json({ success: true, data: withRates, message: "Conversion stats loaded" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load conversion stats" });
  }
};

const CRM_ADMIN_ROLES = ["super_admin", "admin"];

export const getDailyReport = async (req, res) => {
  try {
    const role = req.crmRole || req.admin.role;
    const repId = CRM_ADMIN_ROLES.includes(role) ? null : req.admin._id;
    const report = await buildDailyReport({ from: req.query.from, to: req.query.to, repId });
    if (report.error) return res.status(400).json({ success: false, message: report.error });
    res.json({ success: true, data: report, message: "Daily report loaded" });
  } catch (err) {
    console.error("getDailyReport error:", err);
    res.status(500).json({ success: false, message: "Failed to load daily report" });
  }
};

// Sends the report for a given day to the caller only (admin preview), so a
// manual send can never email the whole admin list by accident.
export const emailDailyReportToMe = async (req, res) => {
  try {
    const from = req.body?.from ?? req.body?.date;
    const to = req.body?.to ?? from;
    const range = resolveRange(from, to);
    if (range.error) return res.status(400).json({ success: false, message: range.error });
    const { sent, report } = await sendDailyReportEmail({ from, to, recipients: [req.admin.email] });
    if (!sent) return res.status(400).json({ success: false, message: "No recipient" });
    const label = report.from === report.to ? report.from : `${report.from} → ${report.to}`;
    res.json({ success: true, message: `Report for ${label} emailed to ${req.admin.email}` });
  } catch (err) {
    console.error("emailDailyReportToMe error:", err);
    res.status(500).json({ success: false, message: "Failed to send report" });
  }
};

// Read-only call review for one rep: every call note in the range with its lead's
// stage and follow-up, open tasks, and assigned leads not yet called.
export const getCallSummary = async (req, res) => {
  try {
    const role = req.crmRole || req.admin.role;
    const { user, from, to } = req.query;
    const repId = CRM_ADMIN_ROLES.includes(role) ? user : String(req.admin._id);
    if (!isValidId(repId)) return res.status(400).json({ success: false, message: "user (rep id) is required" });
    const range = resolveRange(from, to);
    if (range.error) return res.status(400).json({ success: false, message: range.error });

    const rep = await CrmUser.findById(repId).select("name email crmRole active").lean();
    if (!rep) return res.status(404).json({ success: false, message: "Rep not found" });

    const calls = await CRMActivity.find({ type: "call", performedBy: repId, createdAt: { $gte: range.start, $lt: range.end } })
      .sort({ createdAt: -1 }).limit(2000).select("title body metadata relatedToType relatedToId createdAt").lean();
    const stageChanges = await CRMActivity.find({ type: { $in: ["stage_change", "status_change"] }, performedBy: repId, createdAt: { $gte: range.start, $lt: range.end } })
      .select("relatedToId metadata createdAt").sort({ createdAt: 1 }).lean();

    const leadIds = [...new Set(calls.filter((c) => c.relatedToType === "lead").map((c) => String(c.relatedToId)))];
    const [leads, tasks, assigned] = await Promise.all([
      CRMLead.find({ _id: { $in: leadIds } }).populate("tags", "name").select("name phone status nextFollowUp source tags").lean(),
      CRMTask.find({ isDeleted: false, assignedTo: repId, status: { $in: ["open", "in_progress"] } })
        .sort({ dueDate: 1 }).limit(500).select("title type priority dueDate relatedToType relatedToId").lean(),
      CRMLead.find({ isDeleted: false, assignedTo: repId, status: { $nin: ["won", "enrolled", "lost", "junk"] } })
        .populate("tags", "name").select("name phone status source nextFollowUp tags createdAt").lean(),
    ]);

    const leadMap = new Map(leads.map((l) => [String(l._id), l]));
    const flags = (l) => (l.tags || []).map((t) => t.name).filter((n) => ["do-not-contact", "bad-email"].includes(n));
    const stagesByLead = {};
    stageChanges.forEach((s) => { (stagesByLead[String(s.relatedToId)] ||= []).push({ from: s.metadata?.from, to: s.metadata?.to, at: s.createdAt }); });

    const callRows = calls.map((c) => {
      const l = leadMap.get(String(c.relatedToId));
      return {
        at: c.createdAt, lead: l?.name || null, leadId: String(c.relatedToId), phone: l?.phone || null,
        title: c.title, note: c.body, outcome: c.metadata?.outcome ?? null, duration: c.metadata?.duration ?? null,
        stageNow: l?.status || null, nextFollowUp: l?.nextFollowUp || null, flags: l ? flags(l) : [],
        stageChanges: stagesByLead[String(c.relatedToId)] || [],
      };
    });

    const called = new Set(leadIds);
    const byOutcome = {};
    callRows.forEach((r) => { const k = r.outcome || "unspecified"; byOutcome[k] = (byOutcome[k] || 0) + 1; });
    const now = new Date();

    res.json({
      success: true,
      data: {
        rep, range: { from: range.from, to: range.to },
        totals: { calls: callRows.length, leadsCalled: called.size, byOutcome },
        calls: callRows,
        openTasks: tasks.map((t) => ({ ...t, overdue: !!t.dueDate && t.dueDate < now })),
        followUpsDue: assigned.filter((l) => l.nextFollowUp && l.nextFollowUp <= now)
          .map((l) => ({ id: l._id, name: l.name, phone: l.phone, status: l.status, nextFollowUp: l.nextFollowUp, flags: flags(l) })),
        notYetCalled: assigned.filter((l) => !called.has(String(l._id)))
          .map((l) => ({ id: l._id, name: l.name, phone: l.phone, status: l.status, source: l.source, createdAt: l.createdAt, flags: flags(l) })),
      },
      message: "Call summary loaded",
    });
  } catch (err) {
    console.error("getCallSummary error:", err);
    res.status(500).json({ success: false, message: "Failed to load call summary" });
  }
};
