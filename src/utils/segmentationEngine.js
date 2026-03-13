import { User } from "../models/user.model.js";

/**
 * Segmentation engine for email campaigns
 * Identifies user groups based on campaign segment rules
 */

/**
 * Get all enrolled users
 */
export const getEnrolledUsers = async (options = {}) => {
  try {
    const query = {
      status: { $in: ["enrolled", "in-progress"] },
      email: { $exists: true, $ne: null },
    };

    const limit = options.limit || 10000;
    const skip = options.skip || 0;

    const users = await User.find(query)
      .select("email name courseTitle enrolledAt status")
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await User.countDocuments(query);
    return { users, total };
  } catch (error) {
    console.error("Error getting enrolled users:", error);
    throw error;
  }
};

/**
 * Get users enrolled in specific courses
 */
export const getUsersByCourses = async (courseIds = [], options = {}) => {
  try {
    if (!courseIds || courseIds.length === 0) return { users: [], total: 0 };

    const query = {
      courseId: { $in: courseIds },
      status: { $in: ["enrolled", "in-progress"] },
      email: { $exists: true, $ne: null },
    };

    const limit = options.limit || 10000;
    const skip = options.skip || 0;

    const users = await User.find(query)
      .select("email name courseTitle enrolledAt status")
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await User.countDocuments(query);
    return { users, total };
  } catch (error) {
    console.error("Error getting users by courses:", error);
    throw error;
  }
};

/**
 * Get active referral partners (users with referral code and referrals made)
 */
export const getReferralPartners = async (options = {}) => {
  try {
    const query = {
      referralCode: { $exists: true, $ne: null },
      referralCount: { $gt: 0 },
      email: { $exists: true, $ne: null },
    };

    const limit = options.limit || 10000;
    const skip = options.skip || 0;

    const users = await User.find(query)
      .select("email name referralCode referralCount joinedAt")
      .sort({ referralCount: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await User.countDocuments(query);
    return { users, total };
  } catch (error) {
    console.error("Error getting referral partners:", error);
    throw error;
  }
};

/**
 * Get inactive users (no login in last X days)
 */
export const getInactiveUsers = async (daysInactive = 30, options = {}) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

    const query = {
      status: { $in: ["enrolled", "in-progress"] },
      lastAccessedAt: { $lt: cutoffDate },
      email: { $exists: true, $ne: null },
    };

    const limit = options.limit || 10000;
    const skip = options.skip || 0;

    const users = await User.find(query)
      .select("email name lastAccessedAt enrolledAt status")
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await User.countDocuments(query);
    return { users, total };
  } catch (error) {
    console.error("Error getting inactive users:", error);
    throw error;
  }
};

/**
 * Get users with abandoned enrollments (incomplete payments after 3+ days)
 */
export const getAbandonedEnrollmentUsers = async (daysAbandoned = 3, options = {}) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysAbandoned);

    const query = {
      status: "pending-payment",
      createdAt: { $lt: cutoffDate },
      email: { $exists: true, $ne: null },
    };

    const limit = options.limit || 10000;
    const skip = options.skip || 0;

    const users = await User.find(query)
      .select("email name courseTitle createdAt status price")
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await User.countDocuments(query);
    return { users, total };
  } catch (error) {
    console.error("Error getting abandoned enrollment users:", error);
    throw error;
  }
};

/**
 * Apply custom filters to user query
 */
export const applyCustomFilters = async (filters = [], options = {}) => {
  try {
    if (!filters || filters.length === 0) {
      return { users: [], total: 0 };
    }

    // Build MongoDB query from filters
    const query = { email: { $exists: true, $ne: null } };

    filters.forEach((filter) => {
      const { field, operator, value } = filter;

      switch (operator) {
        case "equals":
          query[field] = value;
          break;
        case "gt":
          query[field] = { $gt: value };
          break;
        case "gte":
          query[field] = { $gte: value };
          break;
        case "lt":
          query[field] = { $lt: value };
          break;
        case "lte":
          query[field] = { $lte: value };
          break;
        case "regex":
          query[field] = { $regex: value, $options: "i" };
          break;
        case "in":
          query[field] = { $in: Array.isArray(value) ? value : [value] };
          break;
        case "nin":
          query[field] = { $nin: Array.isArray(value) ? value : [value] };
          break;
      }
    });

    const limit = options.limit || 10000;
    const skip = options.skip || 0;

    const users = await User.find(query)
      .select("email name status enrolledAt")
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await User.countDocuments(query);
    return { users, total };
  } catch (error) {
    console.error("Error applying custom filters:", error);
    throw error;
  }
};

/**
 * Get combined segments based on campaign rules
 * Supports multiple segments (OR logic: all segments combined)
 */
export const getSegmentedUsers = async (segmentRules, options = {}) => {
  try {
    let allUsers = [];
    const userIds = new Set(); // Track unique users

    // Get enrolled users
    if (segmentRules.enrolledUsers) {
      const { users } = await getEnrolledUsers(options);
      users.forEach((u) => {
        if (!userIds.has(u._id.toString())) {
          userIds.add(u._id.toString());
          allUsers.push(u);
        }
      });
    }

    // Get course-specific users
    if (segmentRules.courseIds && segmentRules.courseIds.length > 0) {
      const { users } = await getUsersByCourses(segmentRules.courseIds, options);
      users.forEach((u) => {
        if (!userIds.has(u._id.toString())) {
          userIds.add(u._id.toString());
          allUsers.push(u);
        }
      });
    }

    // Get referral partners
    if (segmentRules.referralPartners) {
      const { users } = await getReferralPartners(options);
      users.forEach((u) => {
        if (!userIds.has(u._id.toString())) {
          userIds.add(u._id.toString());
          allUsers.push(u);
        }
      });
    }

    // Get inactive users
    if (segmentRules.inactiveUsers) {
      const { users } = await getInactiveUsers(30, options);
      users.forEach((u) => {
        if (!userIds.has(u._id.toString())) {
          userIds.add(u._id.toString());
          allUsers.push(u);
        }
      });
    }

    // Get abandoned enrollment users
    if (segmentRules.abandonedEnrollments) {
      const { users } = await getAbandonedEnrollmentUsers(3, options);
      users.forEach((u) => {
        if (!userIds.has(u._id.toString())) {
          userIds.add(u._id.toString());
          allUsers.push(u);
        }
      });
    }

    // Apply custom filters
    if (segmentRules.customFilters && segmentRules.customFilters.length > 0) {
      const { users } = await applyCustomFilters(
        segmentRules.customFilters,
        options
      );
      users.forEach((u) => {
        if (!userIds.has(u._id.toString())) {
          userIds.add(u._id.toString());
          allUsers.push(u);
        }
      });
    }

    return {
      users: allUsers,
      total: allUsers.length,
    };
  } catch (error) {
    console.error("Error getting segmented users:", error);
    throw error;
  }
};

export default {
  getEnrolledUsers,
  getUsersByCourses,
  getReferralPartners,
  getInactiveUsers,
  getAbandonedEnrollmentUsers,
  applyCustomFilters,
  getSegmentedUsers,
};
