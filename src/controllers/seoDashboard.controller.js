import SeoOpportunity from "../models/seoOpportunity.model.js";
import SeoContact from "../models/seoContact.model.js";
import SeoMonitoring from "../models/seoMonitoring.model.js";
import SeoReport from "../models/seoReport.model.js";

export const getSeoDashboard = async (req, res) => {
  try {
    const [
      totalOpportunities,
      highPriority,
      mediumPriority,
      lowPriority,
      publishedLinks,
      pendingOutreach,
      resourcePages,
      competitors,
      quickWins,
      rejectedSites,
      opportunitiesByType,
      outreachByStatus,
      competitorDistribution,
      recentReports,
    ] = await Promise.all([
      SeoOpportunity.countDocuments({ recordType: { $in: ["priority-opportunity", "competitor-gap"] } }),
      SeoOpportunity.countDocuments({ priority: "High" }),
      SeoOpportunity.countDocuments({ priority: "Medium" }),
      SeoOpportunity.countDocuments({ priority: "Low" }),
      SeoMonitoring.countDocuments({ linkStatus: { $in: ["live", "published"] } }),
      SeoContact.countDocuments({ status: { $in: ["new", "contacted", "follow-up"] } }),
      SeoOpportunity.countDocuments({ recordType: "resource-page" }),
      SeoOpportunity.distinct("competitor", { recordType: "competitor-gap" }).then((a) => a.length),
      SeoOpportunity.countDocuments({ priority: "High", confidence: "High", evidenceLevel: "Verified" }),
      SeoContact.countDocuments({ status: "declined" }),
      SeoOpportunity.aggregate([
        { $match: { opportunityType: { $ne: null } } },
        { $group: { _id: "$opportunityType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      SeoContact.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      SeoOpportunity.aggregate([
        { $match: { recordType: "competitor-gap" } },
        { $group: { _id: "$competitor", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      SeoReport.find().sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    // Monthly growth: opportunities created in the last 30 days vs the 30 before that
    const now = new Date();
    const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const day60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const [last30, prev30] = await Promise.all([
      SeoOpportunity.countDocuments({ createdAt: { $gte: day30 } }),
      SeoOpportunity.countDocuments({ createdAt: { $gte: day60, $lt: day30 } }),
    ]);
    const monthlyGrowth = prev30 > 0 ? (((last30 - prev30) / prev30) * 100).toFixed(1) : last30 > 0 ? 100 : 0;

    return res.json({
      success: true,
      data: {
        kpis: {
          totalOpportunities,
          highPriority,
          mediumPriority,
          lowPriority,
          publishedLinks,
          pendingOutreach,
          resourcePages,
          competitors,
          quickWins,
          rejectedSites,
          monthlyGrowth: Number(monthlyGrowth),
        },
        charts: {
          opportunitiesByType,
          outreachByStatus,
          competitorDistribution,
        },
        recentReports,
      },
    });
  } catch (error) {
    console.error("Error fetching SEO dashboard:", error);
    return res.status(500).json({ success: false, message: "Error fetching SEO dashboard" });
  }
};
