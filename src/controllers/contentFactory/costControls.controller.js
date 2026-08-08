import AiUsageLog from "../../models/aiUsageLog.model.js";

const RANGE_DAYS = { today: 1, "7d": 7, "30d": 30 };

function dateKeyDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

// GET /admin/content-factory/usage?range=today|7d|30d — Mongo aggregation of
// AiUsageLog by day and callType (single aggregation pipeline, not N+1 reads).
export const getUsage = async (req, res) => {
  try {
    const range = ["today", "7d", "30d"].includes(req.query.range) ? req.query.range : "7d";
    const days = RANGE_DAYS[range];
    const sinceDateStr = dateKeyDaysAgo(days);

    const [byDay, byCallType, totals] = await Promise.all([
      AiUsageLog.aggregate([
        { $match: { date: { $gte: sinceDateStr } } },
        {
          $group: {
            _id: "$date",
            tokensIn: { $sum: "$tokensIn" },
            tokensOut: { $sum: "$tokensOut" },
            estimatedCostUsd: { $sum: "$estimatedCostUsd" },
            calls: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      AiUsageLog.aggregate([
        { $match: { date: { $gte: sinceDateStr } } },
        {
          $group: {
            _id: "$callType",
            tokensIn: { $sum: "$tokensIn" },
            tokensOut: { $sum: "$tokensOut" },
            estimatedCostUsd: { $sum: "$estimatedCostUsd" },
            calls: { $sum: 1 },
          },
        },
        { $sort: { estimatedCostUsd: -1 } },
      ]),
      AiUsageLog.aggregate([
        { $match: { date: { $gte: sinceDateStr } } },
        {
          $group: {
            _id: null,
            tokensIn: { $sum: "$tokensIn" },
            tokensOut: { $sum: "$tokensOut" },
            estimatedCostUsd: { $sum: "$estimatedCostUsd" },
            calls: { $sum: 1 },
          },
        },
      ]),
    ]);

    return res.json({
      success: true,
      data: {
        range,
        since: sinceDateStr,
        byDay: byDay.map((r) => ({ date: r._id, ...r, _id: undefined })),
        byCallType: byCallType.map((r) => ({ callType: r._id, ...r, _id: undefined })),
        totals: totals[0] ? { ...totals[0], _id: undefined } : { tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0, calls: 0 },
      },
    });
  } catch (err) {
    console.error("[ContentFactory] getUsage error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
