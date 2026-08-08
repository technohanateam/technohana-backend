import ContentOpportunity from "../../models/contentOpportunity.model.js";
import { Blogs } from "../../models/blogs.model.js";
import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";

// Priority tiers get earlier slots — lower number = scheduled sooner.
const TIER_RANK = {
  TIER_1_STRATEGIC: 0,
  TIER_2_GROWTH: 1,
  TIER_3_EVERGREEN: 2,
  TIER_4_LONG_TAIL: 3,
};

function dateKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// Approved-but-unscheduled backlog: opportunities that already have a
// resulting Blogs doc (i.e. approved by a human) whose Blogs.scheduledAt is
// still null. Paginated.
export async function getBacklog({ page = 1, limit = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

  const approved = await ContentOpportunity.find({
    status: { $in: ["APPROVED", "SCHEDULED"] },
    resultingBlogId: { $ne: null },
  })
    .sort({ overallScore: -1, createdAt: -1 })
    .lean();

  if (approved.length === 0) {
    return { items: [], total: 0, page: safePage, limit: safeLimit };
  }

  const blogIds = approved.map((o) => o.resultingBlogId);
  const unscheduledBlogIds = new Set(
    (await Blogs.find({ _id: { $in: blogIds }, scheduledAt: null }, { _id: 1 }).lean()).map((b) => String(b._id))
  );

  const backlog = approved.filter((o) => unscheduledBlogIds.has(String(o.resultingBlogId)));
  const total = backlog.length;
  const start = (safePage - 1) * safeLimit;
  const items = backlog.slice(start, start + safeLimit);

  return { items, total, page: safePage, limit: safeLimit };
}

// PURE-ish — no DB access inside. `existingCalendarEntries` is an array of
// { scheduledAt, clusterId } for already-scheduled/published Blogs, passed in
// by the caller. `settings` needs targetArticlesPerDay.softMax. Walks forward
// from tomorrow, picking the earliest date that (a) doesn't exceed softMax
// items already on that date and (b) doesn't collide with another item from
// the same topic cluster already on that date. TIER_1 candidates are allowed
// to walk fewer days forward (checked first / bias toward earlier dates) —
// implemented by simply starting the walk at tomorrow for everyone, but
// TIER_1 items short-circuit the diversity-collision check after fewer
// attempts so they aren't pushed out by lower-tier congestion.
export function recommendScheduleDate(opportunity, existingCalendarEntries = [], settings = {}) {
  const softMax = settings?.targetArticlesPerDay?.softMax || 10;
  const tierRank = TIER_RANK[opportunity?.sourceInfo?.priorityTier] ?? TIER_RANK.TIER_3_EVERGREEN;
  const clusterId = opportunity?.clusterId ? String(opportunity.clusterId) : null;

  // Build a working map of dateKey -> { count, clusterIds:Set } we can mutate
  // as we walk forward, seeded from existingCalendarEntries + any dates we
  // haven't reserved yet in this same recommendation call is not needed since
  // callers invoke this once per opportunity — but we still index by day so
  // lookups are O(1) per day-of-walk.
  const byDay = new Map();
  for (const entry of existingCalendarEntries) {
    if (!entry?.scheduledAt) continue;
    const key = dateKey(entry.scheduledAt);
    if (!byDay.has(key)) byDay.set(key, { count: 0, clusterIds: new Set() });
    const bucket = byDay.get(key);
    bucket.count += 1;
    if (entry.clusterId) bucket.clusterIds.add(String(entry.clusterId));
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  // TIER_1 gets first crack at the soonest open day even under moderate
  // congestion by tolerating a cluster collision after a short walk; lower
  // tiers walk further out before compromising on diversity.
  const collisionToleranceDay = tierRank === TIER_RANK.TIER_1_STRATEGIC ? 3 : 14;

  const maxLookaheadDays = 120;
  for (let i = 0; i < maxLookaheadDays; i++) {
    const candidate = new Date(tomorrow);
    candidate.setDate(candidate.getDate() + i);
    const key = dateKey(candidate);
    const bucket = byDay.get(key) || { count: 0, clusterIds: new Set() };

    if (bucket.count >= softMax) continue;

    const clusterCollision = clusterId && bucket.clusterIds.has(clusterId);
    if (clusterCollision && i < collisionToleranceDay) continue;

    return candidate;
  }

  // Fallback — softMax/diversity couldn't be satisfied within the lookahead
  // window; just return the day after the lookahead window ends.
  const fallback = new Date(tomorrow);
  fallback.setDate(fallback.getDate() + maxLookaheadDays);
  return fallback;
}

// DB wrapper: loads the backlog + existing scheduled/published Blogs for the
// next 30 days (joined back to their source opportunity for clusterId where
// available) and annotates each backlog item with a recommendedDate.
export async function getBacklogWithRecommendations({ page = 1, limit = 20 } = {}) {
  const [{ items, total, page: p, limit: l }, settings] = await Promise.all([
    getBacklog({ page, limit }),
    getOrCreateContentFactorySettings(),
  ]);

  if (items.length === 0) {
    return { items: [], total, page: p, limit: l };
  }

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 30);

  const scheduledBlogs = await Blogs.find(
    { scheduledAt: { $gte: now, $lte: windowEnd } },
    { scheduledAt: 1, sourceOpportunityId: 1 }
  ).lean();

  const oppClusterByBlogOpp = new Map();
  const sourceOppIds = scheduledBlogs.map((b) => b.sourceOpportunityId).filter(Boolean);
  if (sourceOppIds.length) {
    const opps = await ContentOpportunity.find({ _id: { $in: sourceOppIds } }, { clusterId: 1 }).lean();
    for (const o of opps) oppClusterByBlogOpp.set(String(o._id), o.clusterId);
  }

  const existingCalendarEntries = scheduledBlogs.map((b) => ({
    scheduledAt: b.scheduledAt,
    clusterId: b.sourceOpportunityId ? oppClusterByBlogOpp.get(String(b.sourceOpportunityId)) : null,
  }));

  const settingsPlain = settings.toObject ? settings.toObject() : settings;

  const annotated = items.map((opportunity) => ({
    ...opportunity,
    recommendedDate: recommendScheduleDate(opportunity, existingCalendarEntries, settingsPlain),
  }));

  return { items: annotated, total, page: p, limit: l };
}
