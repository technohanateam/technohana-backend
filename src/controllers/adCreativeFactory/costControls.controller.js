import AiUsageLog from "../../models/aiUsageLog.model.js";

const RANGE_DAYS = { today: 1, "7d": 7, "30d": 30 };

function dateKeyDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

// GET /admin/ad-creative-factory/usage?range=today|7d|30d — filters the
// shared AiUsageLog collection to this factory's "ad-creative-*" callType
// prefix, so its cost reporting stays independent of Content Factory's.
export const getUsage = async (req, res) => {
  try {
    const range = ["today", "7d", "30d"].includes(req.query.range) ? req.query.range : "7d";
    const days = RANGE_DAYS[range];
    const sinceDateStr = dateKeyDaysAgo(days);
    const match = { date: { $gte: sinceDateStr }, callType: { $regex: "^ad-creative-" } };

    const [byDay, byCallType, totals] = await Promise.all([
      AiUsageLog.aggregate([
        { $match: match },
        { $group: { _id: "$date", tokensIn: { $sum: "$tokensIn" }, tokensOut: { $sum: "$tokensOut" }, estimatedCostUsd: { $sum: "$estimatedCostUsd" }, calls: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      AiUsageLog.aggregate([
        { $match: match },
        { $group: { _id: "$callType", tokensIn: { $sum: "$tokensIn" }, tokensOut: { $sum: "$tokensOut" }, estimatedCostUsd: { $sum: "$estimatedCostUsd" }, calls: { $sum: 1 } } },
        { $sort: { estimatedCostUsd: -1 } },
      ]),
      AiUsageLog.aggregate([
        { $match: match },
        { $group: { _id: null, tokensIn: { $sum: "$tokensIn" }, tokensOut: { $sum: "$tokensOut" }, estimatedCostUsd: { $sum: "$estimatedCostUsd" }, calls: { $sum: 1 } } },
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
    console.error("[AdCreativeFactory] getUsage error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
