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

// Trend-oriented analytics for the Backlink Analytics page (Module 8) —
// distinct from the current-state snapshot above.
export const getBacklinkAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);

    const [
      totalOpportunities,
      highPriority,
      outreachSent,
      totalRepliedOrLater,
      liveLinks,
      lostLinks,
      newLinksThisMonth,
      avgScoreAgg,
      opportunitiesOverTime,
      outreachFunnel,
      linksOverTime,
    ] = await Promise.all([
      SeoOpportunity.countDocuments({}),
      SeoOpportunity.countDocuments({ priority: "High" }),
      SeoContact.countDocuments({ status: { $ne: "new" } }),
      SeoContact.countDocuments({ status: { $in: ["responded", "negotiating", "accepted", "live-link", "published"] } }),
      SeoMonitoring.countDocuments({ linkStatus: { $in: ["live", "published"] } }),
      SeoMonitoring.countDocuments({ linkStatus: "lost" }),
      // publishedDate is only ever set by manual curation/CSV import — links
      // confirmed live by the automated discovery/verification pipeline never
      // populate it, so fall back to the monitoring record's own createdAt
      // (when it started being tracked) whenever publishedDate is absent.
      SeoMonitoring.countDocuments({
        linkStatus: { $in: ["live", "published"] },
        $or: [
          { publishedDate: { $gte: startOfMonth } },
          { publishedDate: { $exists: false }, createdAt: { $gte: startOfMonth } },
        ],
      }),
      SeoOpportunity.aggregate([
        { $match: { overallScore: { $ne: null } } },
        { $group: { _id: null, avg: { $avg: "$overallScore" } } },
      ]),
      SeoOpportunity.aggregate([
        { $match: { createdAt: { $gte: twelveWeeksAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%W", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      SeoContact.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      SeoMonitoring.aggregate([
        { $match: { updatedAt: { $gte: twelveWeeksAgo } } },
        { $group: { _id: { week: { $dateToString: { format: "%Y-%W", date: "$updatedAt" } }, status: "$linkStatus" }, count: { $sum: 1 } } },
        { $sort: { "_id.week": 1 } },
      ]),
    ]);

    const responseRate = outreachSent > 0 ? Number(((totalRepliedOrLater / outreachSent) * 100).toFixed(1)) : 0;
    const averageOpportunityScore = avgScoreAgg[0]?.avg ? Number(avgScoreAgg[0].avg.toFixed(1)) : 0;

    return res.json({
      success: true,
      data: {
        kpis: {
          totalOpportunities,
          highPriority,
          outreachSent,
          responseRate,
          liveLinks,
          lostLinks,
          newLinksThisMonth,
          averageOpportunityScore,
        },
        charts: {
          opportunitiesOverTime,
          outreachFunnel,
          linksOverTime,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching backlink analytics:", error);
    return res.status(500).json({ success: false, message: "Error fetching backlink analytics" });
  }
};
