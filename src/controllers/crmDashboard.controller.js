import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMTask from "../models/crm/crmTask.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMCompany from "../models/crm/crmCompany.model.js";
import { resolveRange, istMonthStart, istDateStr } from "../services/crmDailyReport.js";
import { attachRelated, ownerFilter, sendCrmError } from "../utils/crmQuery.js";

const STATUS_ORDER = [
  "new", "discovery", "needs_analysis", "skill_gap_assessed",
  "course_recommended", "proposal_sent", "negotiation",
  "quotation_sent", "purchase_order", "won", "lost", "junk",
];

export const getDashboardStats = async (req, res) => {
  try {
    // "Today" and "this month" are IST, matching the daily report.
    const { start: todayStart, end: todayEnd } = resolveRange();
    const weekStart  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = istMonthStart();

    // Sales reps see their own data; everyone else sees the team's.
    const assignedFilter = ownerFilter(req);

    const [
      totalLeads,
      newLeadsToday,
      newLeadsThisWeek,
      newLeadsThisMonth,
      leadsByStatus,
      openDeals,
      wonDealsThisMonth,
      totalDealValue,
      wonDealValue,
      tasksDueToday,
      overdueTasksCount,
      openTasksCount,
      totalContacts,
      totalCompanies,
      leadsBySource,
    ] = await Promise.all([
      CRMLead.countDocuments({ isDeleted: false, ...assignedFilter }),
      CRMLead.countDocuments({ isDeleted: false, createdAt: { $gte: todayStart, $lt: todayEnd }, ...assignedFilter }),
      CRMLead.countDocuments({ isDeleted: false, createdAt: { $gte: weekStart }, ...assignedFilter }),
      CRMLead.countDocuments({ isDeleted: false, createdAt: { $gte: monthStart }, ...assignedFilter }),

      CRMLead.aggregate([
        { $match: { isDeleted: false, ...assignedFilter } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      CRMDeal.countDocuments({ isDeleted: false, status: "open", ...assignedFilter }),
      CRMDeal.countDocuments({ isDeleted: false, status: "won", wonAt: { $gte: monthStart }, ...assignedFilter }),

      CRMDeal.aggregate([
        { $match: { isDeleted: false, status: "open", ...assignedFilter } },
        { $group: { _id: null, total: { $sum: "$value" } } },
      ]),

      CRMDeal.aggregate([
        { $match: { isDeleted: false, status: "won", wonAt: { $gte: monthStart }, ...assignedFilter } },
        { $group: { _id: null, total: { $sum: "$value" } } },
      ]),

      CRMTask.find({
        isDeleted: false,
        status: { $in: ["open", "in_progress"] },
        dueDate: { $gte: todayStart, $lt: todayEnd },
        ...assignedFilter,
      })
        .populate("assignedTo", "name email")
        .sort({ dueDate: 1 })
        .limit(10)
        .lean(),

      CRMTask.countDocuments({
        isDeleted: false,
        status: { $in: ["open", "in_progress"] },
        dueDate: { $lt: todayStart },
        ...assignedFilter,
      }),

      CRMTask.countDocuments({
        isDeleted: false,
        status: { $in: ["open", "in_progress"] },
        ...assignedFilter,
      }),

      CRMContact.countDocuments({ isDeleted: false }),
      CRMCompany.countDocuments({ isDeleted: false }),

      CRMLead.aggregate([
        { $match: { isDeleted: false, ...assignedFilter } },
        { $group: { _id: "$source", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const statusMap = Object.fromEntries(leadsByStatus.map((s) => [s._id, s.count]));
    const funnel = STATUS_ORDER.map((s) => ({ status: s, count: statusMap[s] || 0 }));

    res.json({
      success: true,
      data: {
        leads: {
          total: totalLeads,
          today: newLeadsToday,
          thisWeek: newLeadsThisWeek,
          thisMonth: newLeadsThisMonth,
        },
        deals: {
          open: openDeals,
          wonThisMonth: wonDealsThisMonth,
          openPipelineValue: totalDealValue[0]?.total || 0,
          wonRevenueThisMonth: wonDealValue[0]?.total || 0,
        },
        tasks: {
          dueToday: tasksDueToday,
          overdue: overdueTasksCount,
          open: openTasksCount,
        },
        contacts: totalContacts,
        companies: totalCompanies,
        funnel,
        leadsBySource,
      },
    });
  } catch (err) {
    console.error("CRM dashboard stats error:", err);
    sendCrmError(res, err, "Failed to load dashboard stats");
  }
};

export const getFunnelData = async (req, res) => {
  try {
    const result = await CRMLead.aggregate([
      { $match: { isDeleted: false, ...ownerFilter(req) } },
      { $group: { _id: "$status", count: { $sum: 1 }, totalExpectedRevenue: { $sum: "$expectedRevenue" } } },
    ]);
    result.sort((a, b) => STATUS_ORDER.indexOf(a._id) - STATUS_ORDER.indexOf(b._id));

    res.json({ success: true, data: result });
  } catch (err) {
    sendCrmError(res, err, "Failed to load funnel data");
  }
};

export const getLeadSourcesBreakdown = async (req, res) => {
  try {
    const result = await CRMLead.aggregate([
      { $match: { isDeleted: false, ...ownerFilter(req) } },
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json({ success: true, data: result });
  } catch (err) {
    sendCrmError(res, err, "Failed to load lead sources");
  }
};

export const getAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const own = ownerFilter(req);
    const [dealsWonByMonth, leadsCreatedByMonth, dealStatusCounts, activityByType, avgWon] = await Promise.all([
      CRMDeal.aggregate([
        { $match: { isDeleted: false, status: "won", wonAt: { $gte: sixMonthsAgo }, ...own } },
        { $group: {
          _id: { year: { $year: "$wonAt" }, month: { $month: "$wonAt" } },
          revenue: { $sum: "$value" },
          count: { $sum: 1 },
        }},
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),

      CRMLead.aggregate([
        { $match: { isDeleted: false, createdAt: { $gte: sixMonthsAgo }, ...own } },
        { $group: {
          _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
          count: { $sum: 1 },
        }},
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),

      CRMDeal.aggregate([
        { $match: { isDeleted: false, ...own } },
        { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$value" } } },
      ]),

      CRMActivity.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, ...ownerFilter(req, "performedBy") } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      CRMDeal.aggregate([
        { $match: { isDeleted: false, status: "won", ...own } },
        { $group: { _id: null, avg: { $avg: "$value" } } },
      ]),
    ]);

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthKeys = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthKeys.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: MONTHS[d.getMonth()] });
    }

    const dealsWonMap = Object.fromEntries(dealsWonByMonth.map((d) => [`${d._id.year}-${d._id.month}`, d]));
    const leadsMap    = Object.fromEntries(leadsCreatedByMonth.map((d) => [`${d._id.year}-${d._id.month}`, d]));

    const monthlyTrends = monthKeys.map((m) => {
      const key = `${m.year}-${m.month}`;
      return {
        month: m.label,
        revenue: dealsWonMap[key]?.revenue || 0,
        dealsWon: dealsWonMap[key]?.count || 0,
        newLeads: leadsMap[key]?.count || 0,
      };
    });

    const wonCount  = dealStatusCounts.find((d) => d._id === "won")?.count || 0;
    const lostCount = dealStatusCounts.find((d) => d._id === "lost")?.count || 0;
    const winRate   = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;
    const avgDealValue = Math.round(avgWon[0]?.avg || 0);

    res.json({
      success: true,
      data: {
        monthlyTrends,
        dealsByStatus: dealStatusCounts,
        activityByType,
        winRate,
        avgDealValue,
        totalWon: wonCount,
        totalLost: lostCount,
      },
    });
  } catch (err) {
    sendCrmError(res, err, "Failed to load analytics");
  }
};

export const getCalendarEvents = async (req, res) => {
  try {
    // month=YYYY-MM, as an IST calendar month (defaults to the current one).
    const month = typeof req.query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month)
      ? req.query.month
      : istDateStr().slice(0, 7);
    const start = new Date(`${month}-01T00:00:00+05:30`);
    const [yr, mo] = month.split("-").map(Number);
    const next = new Date(Date.UTC(yr, mo, 1)).toISOString().slice(0, 7);
    const end = new Date(`${next}-01T00:00:00+05:30`);

    const [tasks, activities] = await Promise.all([
      CRMTask.find({ isDeleted: false, dueDate: { $gte: start, $lt: end }, ...ownerFilter(req) })
        .populate("assignedTo", "name")
        .select("title type status priority dueDate relatedToId relatedToType assignedTo")
        .sort({ dueDate: 1 })
        .limit(1000)
        .lean(),
      CRMActivity.find({ createdAt: { $gte: start, $lt: end }, type: { $in: ["call", "meeting"] }, ...ownerFilter(req, "performedBy") })
        .populate("performedBy", "name")
        .select("type title relatedToId relatedToType createdAt performedBy")
        .sort({ createdAt: 1 })
        .limit(1000)
        .lean(),
    ]);

    const [tasksWithRelated, activitiesWithRelated] = await Promise.all([attachRelated(tasks), attachRelated(activities)]);
    res.json({ success: true, data: { month, tasks: tasksWithRelated, activities: activitiesWithRelated } });
  } catch (err) {
    sendCrmError(res, err, "Failed to load calendar");
  }
};
