import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMTask from "../models/crm/crmTask.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMCompany from "../models/crm/crmCompany.model.js";

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay   = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

export const getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd   = endOfDay(today);
    const weekStart  = new Date(today); weekStart.setDate(today.getDate() - 7);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const adminId = req.admin._id;
    const role    = req.crmRole || req.admin.role;
    // Sales reps see their own data; admins see all
    const assignedFilter = ["sales"].includes(role) ? { assignedTo: adminId } : {};

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
      recentActivities,
      totalContacts,
      totalCompanies,
      leadsBySource,
    ] = await Promise.all([
      CRMLead.countDocuments({ isDeleted: false, ...assignedFilter }),
      CRMLead.countDocuments({ isDeleted: false, createdAt: { $gte: todayStart, $lte: todayEnd }, ...assignedFilter }),
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
        dueDate: { $gte: todayStart, $lte: todayEnd },
        ...(["sales", "trainer"].includes(role) ? { assignedTo: adminId } : {}),
      })
        .populate("assignedTo", "name email")
        .sort({ dueDate: 1 })
        .limit(10)
        .lean(),

      CRMTask.countDocuments({
        isDeleted: false,
        status: { $in: ["open", "in_progress"] },
        dueDate: { $lt: todayStart },
        ...(["sales", "trainer"].includes(role) ? { assignedTo: adminId } : {}),
      }),

      CRMTask.countDocuments({
        isDeleted: false,
        status: { $in: ["open", "in_progress"] },
        ...(["sales", "trainer"].includes(role) ? { assignedTo: adminId } : {}),
      }),

      CRMActivity.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("performedBy", "name")
        .lean(),

      CRMContact.countDocuments({ isDeleted: false }),
      CRMCompany.countDocuments({ isDeleted: false }),

      CRMLead.aggregate([
        { $match: { isDeleted: false, ...assignedFilter } },
        { $group: { _id: "$source", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    // Build funnel from leadsByStatus
    const statusOrder = [
      "new", "discovery", "needs_analysis", "skill_gap_assessed",
      "course_recommended", "proposal_sent", "negotiation",
      "quotation_sent", "purchase_order", "won", "lost", "junk",
    ];
    const statusMap = Object.fromEntries(leadsByStatus.map((s) => [s._id, s.count]));
    const funnel = statusOrder.map((s) => ({ status: s, count: statusMap[s] || 0 }));

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
        recentActivities,
      },
    });
  } catch (err) {
    console.error("CRM dashboard stats error:", err);
    res.status(500).json({ success: false, message: "Failed to load dashboard stats" });
  }
};

export const getFunnelData = async (req, res) => {
  try {
    const adminId = req.admin._id;
    const role    = req.crmRole || req.admin.role;
    const assignedFilter = ["sales"].includes(role) ? { assignedTo: adminId } : {};

    const result = await CRMLead.aggregate([
      { $match: { isDeleted: false, ...assignedFilter } },
      { $group: { _id: "$status", count: { $sum: 1 }, totalExpectedRevenue: { $sum: "$expectedRevenue" } } },
      { $sort: { _id: 1 } },
    ]);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load funnel data" });
  }
};

export const getLeadSourcesBreakdown = async (req, res) => {
  try {
    const result = await CRMLead.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load lead sources" });
  }
};

export const getAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [dealsWonByMonth, leadsCreatedByMonth, dealStatusCounts, activityByType, wonDealsAll] = await Promise.all([
      CRMDeal.aggregate([
        { $match: { isDeleted: false, status: "won", wonAt: { $gte: sixMonthsAgo } } },
        { $group: {
          _id: { year: { $year: "$wonAt" }, month: { $month: "$wonAt" } },
          revenue: { $sum: "$value" },
          count: { $sum: 1 },
        }},
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),

      CRMLead.aggregate([
        { $match: { isDeleted: false, createdAt: { $gte: sixMonthsAgo } } },
        { $group: {
          _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
          count: { $sum: 1 },
        }},
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),

      CRMDeal.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$value" } } },
      ]),

      CRMActivity.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      CRMDeal.find({ isDeleted: false, status: "won" }).select("value").lean(),
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
    const avgDealValue = wonDealsAll.length
      ? Math.round(wonDealsAll.reduce((s, d) => s + (d.value || 0), 0) / wonDealsAll.length)
      : 0;

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
    res.status(500).json({ success: false, message: "Failed to load analytics" });
  }
};

export const getCalendarEvents = async (req, res) => {
  try {
    const { month } = req.query;
    const now = new Date();
    const [yr, mo] = month
      ? month.split("-").map(Number)
      : [now.getFullYear(), now.getMonth() + 1];

    const start = new Date(yr, mo - 1, 1);
    const end   = new Date(yr, mo, 0, 23, 59, 59, 999);

    const role     = req.crmRole || req.admin.role;
    const adminId  = req.admin._id;
    const taskFilter = ["sales"].includes(role) ? { assignedTo: adminId } : {};

    const [tasks, activities] = await Promise.all([
      CRMTask.find({ isDeleted: false, dueDate: { $gte: start, $lte: end }, ...taskFilter })
        .populate("assignedTo", "name")
        .populate("relatedTo", "name email title")
        .select("title type status priority dueDate relatedTo relatedToType assignedTo")
        .lean(),
      CRMActivity.find({ createdAt: { $gte: start, $lte: end } })
        .populate("createdBy", "name")
        .select("type title body relatedTo relatedToType createdAt createdBy")
        .lean(),
    ]);

    res.json({ success: true, data: { tasks, activities } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load calendar" });
  }
};
