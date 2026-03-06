import { User } from "../models/user.model.js";

// Get comprehensive referral analytics for admin dashboard
export const getReferralAnalytics = async (req, res) => {
  try {
    // Total referral metrics
    const [
      totalUsers,
      activeReferrers,
      totalReferralsApplied,
      usersWithReferralCode,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ referralCode: { $exists: true, $ne: null } }),
      User.countDocuments({ referredBy: { $exists: true, $ne: null } }),
      User.countDocuments({ referralCode: { $exists: true, $ne: null } }),
    ]);

    // Calculate total discount given (10% per referral per user)
    const referrersWithCounts = await User.aggregate([
      {
        $match: {
          referralCode: { $exists: true, $ne: null },
          referralCount: { $gt: 0 },
        },
      },
      {
        $project: {
          _id: 1,
          email: 1,
          name: 1,
          referralCode: 1,
          referralCount: 1,
          referralDiscountPct: { $ifNull: ["$referralDiscountPct", 10] },
        },
      },
      {
        $sort: { referralCount: -1 },
      },
    ]);

    const totalDiscountGiven = referrersWithCounts.reduce((sum, user) => {
      return sum + (user.referralCount * (user.referralDiscountPct || 10));
    }, 0);

    // Estimate commission value (assuming avg course price)
    // This is simplified; in production, would sum actual enrolled course prices per referral
    const avgCoursePrice = 5000; // placeholder
    const estimatedCommissionValue = Math.round(
      (totalDiscountGiven / 100) * avgCoursePrice
    );

    return res.json({
      success: true,
      summary: {
        totalUsers,
        activeReferrers,
        totalReferralsApplied,
        usersWithReferralCode,
        totalDiscountPercentageGiven: totalDiscountGiven,
        estimatedCommissionValue,
        conversionRate: totalUsers > 0 ? ((totalReferralsApplied / totalUsers) * 100).toFixed(2) : 0,
        referrerPenetration: totalUsers > 0 ? ((activeReferrers / totalUsers) * 100).toFixed(2) : 0,
      },
      topReferrers: referrersWithCounts.slice(0, 10).map((user) => ({
        _id: user._id,
        name: user.name || "Unknown",
        email: user.email,
        referralCode: user.referralCode,
        referralCount: user.referralCount,
        discountPercentage:
          user.referralCount * (user.referralDiscountPct || 10),
      })),
    });
  } catch (error) {
    console.error("Error fetching referral analytics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch referral analytics",
    });
  }
};

// Get detailed referral list with pagination and filtering
export const getReferralsList = async (req, res) => {
  try {
    const { search, page = 1, limit = 20, sortBy = "referralCount" } =
      req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build filter
    const filter = {
      referralCode: { $exists: true, $ne: null },
    };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { referralCode: { $regex: search, $options: "i" } },
      ];
    }

    // Determine sort order
    let sortObj = {};
    switch (sortBy) {
      case "referralCount":
        sortObj = { referralCount: -1 };
        break;
      case "recentlyAdded":
        sortObj = { createdAt: -1 };
        break;
      case "name":
        sortObj = { name: 1 };
        break;
      default:
        sortObj = { referralCount: -1 };
    }

    // Fetch data
    const total = await User.countDocuments(filter);
    const referrers = await User.find(filter)
      .select(
        "name email referralCode referralCount referralDiscountPct createdAt"
      )
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .lean();

    return res.json({
      success: true,
      data: referrers.map((user) => ({
        _id: user._id,
        name: user.name || "Unknown",
        email: user.email,
        referralCode: user.referralCode,
        referralCount: user.referralCount || 0,
        discountPercentageGiven:
          (user.referralCount || 0) * (user.referralDiscountPct || 10),
        createdAt: user.createdAt,
      })),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error fetching referrals list:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch referrals list",
    });
  }
};

// Get detailed stats for a specific referrer
export const getReferrerDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    const referrer = await User.findById(userId).select(
      "name email referralCode referralCount referralDiscountPct createdAt courseTitle"
    );

    if (!referrer) {
      return res.status(404).json({
        success: false,
        message: "Referrer not found",
      });
    }

    // Get all users referred by this person
    const referredUsers = await User.find({
      referredBy: referrer.email,
    }).select(
      "name email status enrolledAt courseTitle price currency referralDiscountApplied"
    );

    const stats = {
      referrer: {
        _id: referrer._id,
        name: referrer.name || "Unknown",
        email: referrer.email,
        referralCode: referrer.referralCode,
        referralCount: referrer.referralCount || 0,
        discountPercentage:
          (referrer.referralCount || 0) * (referrer.referralDiscountPct || 10),
        joinedAt: referrer.createdAt,
      },
      referredCount: referredUsers.length,
      enrolledCount: referredUsers.filter((u) => u.status === "enrolled")
        .length,
      conversionRate:
        referredUsers.length > 0
          ? (
            (referredUsers.filter((u) => u.status === "enrolled").length /
              referredUsers.length) *
            100
          ).toFixed(2)
          : 0,
      referredUsers: referredUsers.map((user) => ({
        _id: user._id,
        name: user.name || "Unknown",
        email: user.email,
        status: user.status || "pending-payment",
        enrolledAt: user.enrolledAt,
        courseTitle: user.courseTitle,
        price: user.price,
        currency: user.currency,
        receivedDiscount: user.referralDiscountApplied,
      })),
    };

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching referrer details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch referrer details",
    });
  }
};

// Get referral distribution metrics
export const getReferralMetrics = async (req, res) => {
  try {
    // Distribution of referral counts
    const distribution = await User.aggregate([
      {
        $match: {
          referralCode: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: null,
          zero: {
            $sum: {
              $cond: [{ $eq: ["$referralCount", 0] }, 1, 0],
            },
          },
          one: {
            $sum: {
              $cond: [{ $and: [{ $gte: ["$referralCount", 1] }, { $lt: ["$referralCount", 3] }] }, 1, 0],
            },
          },
          three: {
            $sum: {
              $cond: [{ $and: [{ $gte: ["$referralCount", 3] }, { $lt: ["$referralCount", 5] }] }, 1, 0],
            },
          },
          five: {
            $sum: {
              $cond: [{ $and: [{ $gte: ["$referralCount", 5] }, { $lt: ["$referralCount", 10] }] }, 1, 0],
            },
          },
          ten: {
            $sum: {
              $cond: [{ $and: [{ $gte: ["$referralCount", 10] }, { $lt: ["$referralCount", 20] }] }, 1, 0],
            },
          },
          twenty: {
            $sum: {
              $cond: [{ $gte: ["$referralCount", 20] }, 1, 0],
            },
          },
          avgReferrals: { $avg: "$referralCount" },
          maxReferrals: { $max: "$referralCount" },
        },
      },
    ]);

    const metrics = distribution[0] || {
      zero: 0,
      one: 0,
      three: 0,
      five: 0,
      ten: 0,
      twenty: 0,
      avgReferrals: 0,
      maxReferrals: 0,
    };

    return res.json({
      success: true,
      distribution: {
        noReferrals: metrics.zero,
        oneToTwo: metrics.one,
        threeToFour: metrics.three,
        fiveToNine: metrics.five,
        tenToNineteen: metrics.ten,
        twentyPlus: metrics.twenty,
      },
      stats: {
        averageReferralsPerUser: metrics.avgReferrals.toFixed(2),
        maxReferralsPerUser: metrics.maxReferrals,
      },
    });
  } catch (error) {
    console.error("Error fetching referral metrics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch referral metrics",
    });
  }
};
