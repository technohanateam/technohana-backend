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
