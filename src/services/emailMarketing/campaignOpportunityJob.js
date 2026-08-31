import { User } from "../../models/user.model.js";
import Enquiry from "../../models/enquiry.model.js";
import Coupon from "../../models/coupon.model.js";
import CampaignOpportunity from "../../models/campaignOpportunity.model.js";
import {
  getInactiveUsers,
  getAbandonedEnrollmentUsers,
} from "../../utils/segmentationEngine.js";

// Campaign Opportunity Engine (analog of the blog Content Factory's daily
// planning job): scans existing signals — at-risk learners, abandoned
// enrollments, hot leads, expiring coupons, inactive users — and proposes
// campaigns for an admin to review, instead of sending anything itself.

const AT_RISK_INACTIVE_DAYS = 14;
const MIN_MATCH_TO_PROPOSE = 3;
const RESCAN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // don't re-propose the same type within 7 days

async function upsertOpportunity({ type, title, rationale, segmentFilter, suggestedBrief, suggestedSendWindow, matchedCount }) {
  const recent = await CampaignOpportunity.findOne({
    type,
    status: "proposed",
    createdAt: { $gte: new Date(Date.now() - RESCAN_COOLDOWN_MS) },
  });

  if (recent) {
    recent.matchedCount = matchedCount;
    recent.priorityScore = scorePriority(type, matchedCount);
    await recent.save();
    return { created: false };
  }

  await CampaignOpportunity.create({
    type,
    title,
    rationale,
    segmentFilter,
    suggestedBrief,
    suggestedSendWindow,
    matchedCount,
    priorityScore: scorePriority(type, matchedCount),
  });
  return { created: true };
}

function scorePriority(type, count) {
  const urgencyWeight = { hot_leads: 1.5, expiring_coupon: 1.3, abandoned_enrollment: 1.2, at_risk_learners: 1, inactive_users: 0.8 };
  return Math.min(100, Math.round(count * (urgencyWeight[type] || 1) * 2));
}

export async function runCampaignOpportunityScan() {
  let created = 0;
  const scanned = { at_risk_learners: 0, abandoned_enrollment: 0, hot_leads: 0, expiring_coupon: 0, inactive_users: 0 };

  try {
    // At-risk learners
    const cutoff = new Date(Date.now() - AT_RISK_INACTIVE_DAYS * 24 * 60 * 60 * 1000);
    const atRiskCount = await User.countDocuments({
      enrollmentStatus: { $in: ["active", "enrolled"] },
      lastAccessedAt: { $lt: cutoff, $exists: true },
    });
    scanned.at_risk_learners = atRiskCount;
    if (atRiskCount >= MIN_MATCH_TO_PROPOSE) {
      const r = await upsertOpportunity({
        type: "at_risk_learners",
        title: `${atRiskCount} learners inactive ${AT_RISK_INACTIVE_DAYS}+ days`,
        rationale: `${atRiskCount} enrolled learners haven't logged in for ${AT_RISK_INACTIVE_DAYS}+ days. A re-engagement campaign (distinct from the individual daily at-risk nudges) could recover more of this segment.`,
        segmentFilter: { inactiveUsers: true },
        suggestedBrief: "Re-engage learners who have gone quiet on their course. Warm, no-pressure tone, remind them of the progress they've already made and what they'll gain by continuing.",
        suggestedSendWindow: "Within 3 days",
        matchedCount: atRiskCount,
      });
      if (r.created) created++;
    }

    // Abandoned enrollments (3+ days pending payment)
    const { total: abandonedCount } = await getAbandonedEnrollmentUsers(3, { limit: 1 });
    scanned.abandoned_enrollment = abandonedCount;
    if (abandonedCount >= MIN_MATCH_TO_PROPOSE) {
      const r = await upsertOpportunity({
        type: "abandoned_enrollment",
        title: `${abandonedCount} abandoned enrollments 3+ days old`,
        rationale: `${abandonedCount} users started enrollment but didn't complete payment 3+ days ago. Beyond the individual per-user recovery emails, a segment-wide campaign could reach anyone who didn't get one.`,
        segmentFilter: { abandonedEnrollments: true },
        suggestedBrief: "Nudge users who started but didn't finish their enrollment. Friendly, zero pressure, remind them what they were signing up for.",
        suggestedSendWindow: "Immediately",
        matchedCount: abandonedCount,
      });
      if (r.created) created++;
    }

    // Hot leads awaiting follow-up
    const hotLeadCount = await Enquiry.countDocuments({
      aiScoreBand: "hot",
      aiSuggestedFollowUp: { $lte: new Date() },
    });
    scanned.hot_leads = hotLeadCount;
    if (hotLeadCount >= MIN_MATCH_TO_PROPOSE) {
      const r = await upsertOpportunity({
        type: "hot_leads",
        title: `${hotLeadCount} hot leads past their follow-up date`,
        rationale: `${hotLeadCount} enquiries scored "hot" by lead scoring have passed their suggested follow-up date without a campaign touch.`,
        segmentFilter: { customFilters: [{ field: "type", operator: "in", value: ["prospect"] }, { field: "aiScoreBand", operator: "in", value: ["hot"] }] },
        suggestedBrief: "Follow up with high-intent prospects who requested training info. Direct, helpful, offer to answer questions or set up a call.",
        suggestedSendWindow: "Within 24 hours",
        matchedCount: hotLeadCount,
      });
      if (r.created) created++;
    }

    // Coupons expiring within the next 7 days
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiringCoupons = await Coupon.find({
      isActive: true,
      expiryDate: { $gte: new Date(), $lte: soon },
    }).select("code discountPercent expiryDate").lean();
    scanned.expiring_coupon = expiringCoupons.length;
    if (expiringCoupons.length > 0) {
      const r = await upsertOpportunity({
        type: "expiring_coupon",
        title: `${expiringCoupons.length} coupon(s) expiring within 7 days`,
        rationale: `Active coupon(s) expiring soon: ${expiringCoupons.map((c) => c.code).join(", ")}. A reminder campaign could lift redemptions before they lapse. The campaign copy itself must not hardcode the code or discount — the coupon controller resolves it server-side per CLAUDE.md.`,
        segmentFilter: { enrolledUsers: false, inactiveUsers: true, abandonedEnrollments: true },
        suggestedBrief: "Remind prospects that a limited-time offer is ending soon. Do not state the discount percentage or code directly — reference 'a special offer' and let the enrollment page surface the exact terms.",
        suggestedSendWindow: "2-3 days before expiry",
        matchedCount: expiringCoupons.length,
      });
      if (r.created) created++;
    }

    // Inactive users, 30+ days no login
    const { total: inactiveCount } = await getInactiveUsers(30, { limit: 1 });
    scanned.inactive_users = inactiveCount;
    if (inactiveCount >= MIN_MATCH_TO_PROPOSE * 3) {
      const r = await upsertOpportunity({
        type: "inactive_users",
        title: `${inactiveCount} users inactive 30+ days`,
        rationale: `${inactiveCount} users haven't logged in for 30+ days — broader than the at-risk (14-day) segment.`,
        segmentFilter: { inactiveUsers: true },
        suggestedBrief: "Win back long-inactive users with a light-touch check-in. Curious, not pushy — ask what would help them come back.",
        suggestedSendWindow: "Within a week",
        matchedCount: inactiveCount,
      });
      if (r.created) created++;
    }

    console.log(`[CampaignOpportunityJob] Scan complete — created ${created} new opportunities`, scanned);
    return { created, scanned };
  } catch (err) {
    console.error("[CampaignOpportunityJob] Scan failed:", err.message);
    return { created, scanned, error: err.message };
  }
}
