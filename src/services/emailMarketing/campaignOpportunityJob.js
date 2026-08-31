import CampaignOpportunity from "../../models/campaignOpportunity.model.js";
import Enquiry from "../../models/enquiry.model.js";
import Coupon from "../../models/coupon.model.js";
import { User } from "../../models/user.model.js";

// Campaign Opportunity Engine — analog of contentFactory's
// dailyPlanningJob.processor.js. Scans signals already computed elsewhere in
// the codebase (lead scores, abandoned enrollments, inactive users, expiring
// coupons) and proposes CampaignOpportunity candidates for an admin to review
// and approve into a draft Campaign. Never sends anything itself.

const HOT_LEAD_FOLLOWUP_STALE_DAYS = 2; // hot leads with no follow-up scheduled/overdue
const INACTIVE_WINBACK_DAYS = 30; // mirrors segmentationEngine's inactiveUsers threshold
const ABANDONED_ENROLLMENT_DAYS = 3; // mirrors segmentationEngine's abandonedEnrollments threshold
const COUPON_EXPIRING_WITHIN_DAYS = 7;

// Skip proposing a new opportunity of the same type if one is already
// PROPOSED and less than a day old — avoids spamming duplicate suggestions
// on every run of a daily/weekly cron.
async function hasRecentProposal(type) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await CampaignOpportunity.findOne({ type, status: "PROPOSED", createdAt: { $gte: cutoff } });
  return Boolean(existing);
}

async function findHotLeadFollowupOpportunity() {
  if (await hasRecentProposal("HOT_LEAD_FOLLOWUP")) return null;

  const cutoff = new Date(Date.now() - HOT_LEAD_FOLLOWUP_STALE_DAYS * 24 * 60 * 60 * 1000);
  const count = await Enquiry.countDocuments({
    aiScoreBand: "hot",
    email: { $exists: true, $ne: null },
    $or: [{ aiSuggestedFollowUp: { $lt: new Date() } }, { aiSuggestedFollowUp: null, aiScoredAt: { $lt: cutoff } }],
  });
  if (count === 0) return null;

  return {
    type: "HOT_LEAD_FOLLOWUP",
    rationale: `${count} hot-scored enquiries are past their AI-suggested follow-up window with no recent outreach.`,
    suggestedBrief: "A prompt, personal follow-up for a hot corporate/group training enquiry that has gone quiet — reiterate we're ready to help and ask what would move things forward.",
    segmentFilter: { customFilters: [{ field: "type", operator: "in", value: ["prospect"] }, { field: "aiScoreBand", operator: "in", value: ["hot"] }] },
    audienceSize: count,
    priorityScore: Math.min(100, 60 + count),
    sourceInfo: { staleDays: HOT_LEAD_FOLLOWUP_STALE_DAYS },
  };
}

async function findAtRiskLearnerOpportunity() {
  if (await hasRecentProposal("AT_RISK_LEARNER")) return null;

  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const count = await User.countDocuments({
    enrollmentStatus: { $in: ["active", "enrolled"] },
    lastAccessedAt: { $lt: cutoff, $exists: true },
  });
  if (count === 0) return null;

  return {
    type: "AT_RISK_LEARNER",
    rationale: `${count} enrolled learners have been inactive for 14+ days (churn risk).`,
    suggestedBrief: "A warm, encouraging nudge to re-engage learners who have paused their course — focus on the progress they've already made and what's left to unlock.",
    segmentFilter: { inactiveUsers: true },
    audienceSize: count,
    priorityScore: Math.min(100, 50 + count),
    sourceInfo: { inactiveDays: 14 },
  };
}

async function findAbandonedEnrollmentOpportunity() {
  if (await hasRecentProposal("ABANDONED_ENROLLMENT")) return null;

  const cutoff = new Date(Date.now() - ABANDONED_ENROLLMENT_DAYS * 24 * 60 * 60 * 1000);
  const count = await User.countDocuments({
    status: "pending-payment",
    createdAt: { $lt: cutoff },
    email: { $exists: true, $ne: null },
  });
  if (count === 0) return null;

  return {
    type: "ABANDONED_ENROLLMENT",
    rationale: `${count} enrollment forms have been abandoned for ${ABANDONED_ENROLLMENT_DAYS}+ days without completing payment.`,
    suggestedBrief: "A no-pressure nudge to finish an enrollment that was started but not completed, referencing progress made without inventing details.",
    segmentFilter: { abandonedEnrollments: true },
    audienceSize: count,
    priorityScore: Math.min(100, 55 + count),
    sourceInfo: { abandonedDays: ABANDONED_ENROLLMENT_DAYS },
  };
}

async function findInactiveWinbackOpportunity() {
  if (await hasRecentProposal("INACTIVE_WINBACK")) return null;

  const cutoff = new Date(Date.now() - INACTIVE_WINBACK_DAYS * 24 * 60 * 60 * 1000);
  const count = await User.countDocuments({
    status: { $in: ["enrolled", "in-progress"] },
    lastAccessedAt: { $lt: cutoff },
    email: { $exists: true, $ne: null },
  });
  if (count === 0) return null;

  return {
    type: "INACTIVE_WINBACK",
    rationale: `${count} users have had no login activity in ${INACTIVE_WINBACK_DAYS}+ days.`,
    suggestedBrief: "A friendly check-in email reminding a dormant user what they signed up for and inviting them back, without pressure.",
    segmentFilter: { inactiveUsers: true },
    audienceSize: count,
    priorityScore: Math.min(100, 40 + Math.floor(count / 2)),
    sourceInfo: { inactiveDays: INACTIVE_WINBACK_DAYS },
  };
}

async function findCouponExpiringOpportunity() {
  if (await hasRecentProposal("COUPON_EXPIRING")) return null;

  const windowEnd = new Date(Date.now() + COUPON_EXPIRING_WITHIN_DAYS * 24 * 60 * 60 * 1000);
  const coupons = await Coupon.find({
    isActive: true,
    expiryDate: { $ne: null, $gte: new Date(), $lte: windowEnd },
  }).select("code discountPercent expiryDate validCurrencies");
  if (coupons.length === 0) return null;

  return {
    type: "COUPON_EXPIRING",
    rationale: `${coupons.length} active coupon(s) expire within ${COUPON_EXPIRING_WITHIN_DAYS} days: ${coupons.map((c) => c.code).join(", ")}.`,
    suggestedBrief: "A timely reminder that a limited-time offer is ending soon — mention urgency honestly without fake countdowns. Do not state the exact code or percentage in the brief; the copy pipeline strips those and the send template inserts the real code.",
    segmentFilter: { enrolledUsers: false, customFilters: [] },
    audienceSize: 0, // depends on which segment an admin picks when approving — not resolvable from the coupon alone
    priorityScore: 65,
    sourceInfo: { coupons: coupons.map((c) => ({ code: c.code, expiryDate: c.expiryDate })) },
  };
}

// Runs all signal scans and persists any new opportunities found. Never
// throws — a failed scan for one signal shouldn't block the others.
export async function runCampaignOpportunityScan({ triggeredBy = "CRON" } = {}) {
  const finders = [
    findHotLeadFollowupOpportunity,
    findAtRiskLearnerOpportunity,
    findAbandonedEnrollmentOpportunity,
    findInactiveWinbackOpportunity,
    findCouponExpiringOpportunity,
  ];

  const created = [];
  const errors = [];

  for (const find of finders) {
    try {
      const candidate = await find();
      if (candidate) {
        const doc = await CampaignOpportunity.create(candidate);
        created.push(doc);
      }
    } catch (err) {
      console.error(`[campaignOpportunityJob] ${find.name} failed:`, err.message);
      errors.push(`${find.name}: ${err.message}`);
    }
  }

  console.log(`[campaignOpportunityJob] (${triggeredBy}) created ${created.length} opportunit${created.length === 1 ? "y" : "ies"}${errors.length ? `, ${errors.length} error(s)` : ""}`);
  return { created, errors };
}
