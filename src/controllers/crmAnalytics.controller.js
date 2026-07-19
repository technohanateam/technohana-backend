import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";

export const getRevenueTrend = async (req, res) => {
  try {
    const { period = "month" } = req.query;

    // Build grouping format based on period
    const dateFormat = period === "week"
      ? { $dateToString: { format: "%Y-%m-%d", date: "$wonAt" } }
      : { $dateToString: { format: "%Y-%m", date: "$wonAt" } };

    const cutoff = new Date();
    if (period === "week")    cutoff.setDate(cutoff.getDate() - 84); // 12 weeks
    else if (period === "quarter") cutoff.setMonth(cutoff.getMonth() - 12); // 4 quarters
    else cutoff.setMonth(cutoff.getMonth() - 11); // 12 months

    const result = await CRMDeal.aggregate([
      {
        $match: {
          isDeleted: false,
          status: "won",
          wonAt: { $gte: cutoff },
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
    const adminId = req.admin._id;
    const role    = req.crmRole || req.admin.role;
    const matchFilter = role === "sales"
      ? { isDeleted: false, assignedTo: adminId }
      : { isDeleted: false };

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
            from: "admins",
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
            ...(role === "sales" ? { assignedTo: adminId } : {}),
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
    const adminId = req.admin._id;
    const role    = req.crmRole || req.admin.role;
    const assignedFilter = role === "sales" ? { assignedTo: adminId } : {};

    const STATUS_ORDER = [
      "new", "discovery", "needs_analysis", "skill_gap_assessed",
      "course_recommended", "proposal_sent", "negotiation",
      "quotation_sent", "purchase_order", "won",
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
