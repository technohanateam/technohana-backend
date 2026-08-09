import Course from "../../models/course.model.js";
import { CourseView } from "../../models/courseView.model.js";
import Enquiry from "../../models/enquiry.model.js";
import { Order } from "../../models/order.model.js";
import CourseContentSettings from "../../models/courseContentSettings.model.js";
import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";
import { computeCoursePriorityScore, DEFAULT_CAPS } from "./coursePriorityScoring.service.js";

// Floors beneath which we don't shrink a dynamic cap — protects against a
// single fluke enquiry/view making one course look maximally hot when the
// catalogue-wide dataset is still very sparse (e.g. day one of real usage).
const MIN_DYNAMIC_CAP = { enquiryCount90d: 3, courseViews90d: 10 };

const RECOMPUTE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SIGNAL_WINDOW_DAYS = 90;

// GSC/GA4 metrics (SeoGscMetric/SeoGa4Metric) are keyed by page URL
// (dimensionType "page"/"landingPage"), not by courseSlug/courseId — there is
// no stored mapping from a course to its canonical URL to join against here.
// Rather than guess at a URL pattern, these two signals default to 0 for M1;
// documented as a deviation in docs/AI_CONTENT_FACTORY_IMPLEMENTATION.md.
const GSC_GA4_AVAILABLE = false;

// Bulk-aggregates enquiry/order/view signals (a handful of queries total, no
// per-course loop) and upserts computed priority into CourseContentSettings.
// Only recomputes courses whose lastPriorityComputedAt is null or >24h old,
// unless force=true. Respects priorityOverride: the override is what callers
// should read for tier/score decisions, but this function always writes the
// freshly computed priorityScore/priorityTier so the override never erases
// the underlying computation (see courseContentSettings.model.js comment).
export async function refreshCoursePriorities({ force = false } = {}) {
  const settings = await getOrCreateContentFactorySettings();
  const weights = settings.priorityWeights || {};

  const courses = await Course.find({}, { id: 1, courseSlug: 1, courseTitle: 1, _id: 0 }).lean();
  const eligibleCourses = courses.filter((c) => c.courseSlug);

  let targets = eligibleCourses;
  if (!force) {
    const cutoff = new Date(Date.now() - RECOMPUTE_INTERVAL_MS);
    const recentlyComputedSlugs = new Set(
      (
        await CourseContentSettings.find(
          { lastPriorityComputedAt: { $gte: cutoff } },
          { courseSlug: 1, _id: 0 }
        ).lean()
      ).map((d) => d.courseSlug)
    );
    targets = eligibleCourses.filter((c) => !recentlyComputedSlugs.has(c.courseSlug));
  }

  if (targets.length === 0) {
    return { evaluated: 0, updated: 0 };
  }

  const sinceDate = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [enquiryRows, orderRows, viewRows, existingSettings] = await Promise.all([
    Enquiry.aggregate([
      { $match: { createdAt: { $gte: sinceDate }, courseTitle: { $exists: true, $ne: null, $ne: "" } } },
      { $group: { _id: "$courseTitle", count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { status: "paid", createdAt: { $gte: sinceDate } } },
      { $group: { _id: "$courseId", revenue: { $sum: { $ifNull: ["$expectedTotalMinor", 0] } } } },
    ]),
    CourseView.aggregate([
      { $match: { viewedAt: { $gte: sinceDate } } },
      { $group: { _id: "$courseId", count: { $sum: 1 } } },
    ]),
    CourseContentSettings.find(
      { courseSlug: { $in: targets.map((c) => c.courseSlug) } },
      { courseSlug: 1, lastBlogGeneratedAt: 1, _id: 0 }
    ).lean(),
  ]);

  // Enquiries are grouped by courseTitle, Orders/CourseViews by courseId —
  // mirrors the existing /admin/hot-courses and /admin/revenue-by-course
  // aggregation patterns in admin.routes.js, which use the same fields.
  const enquiryByTitle = new Map(enquiryRows.map((r) => [r._id, r.count]));
  const revenueById = new Map(orderRows.map((r) => [r._id, r.revenue]));
  const viewsById = new Map(viewRows.map((r) => [r._id, r.count]));
  const lastBlogBySlug = new Map(existingSettings.map((s) => [s.courseSlug, s.lastBlogGeneratedAt]));

  // Dynamic caps: DEFAULT_CAPS (coursePriorityScoring.service.js) are guesses
  // with no real distribution to calibrate against. Once real data exists,
  // using a fixed guessed cap that's orders of magnitude above actual usage
  // silently collapses every course's normalized score toward 0 for that
  // signal — confirmed against production data where a 5000-view cap made a
  // catalogue-wide 90-day total of ~2,300 views normalize to near-zero for
  // every course, and the whole priority score degenerated to whatever
  // `recency` alone contributed. Shrinking the cap to the actual observed
  // max (floored so sparse data doesn't overreact to one fluke) restores
  // real differentiation between courses without touching the weighting
  // philosophy or any other signal.
  const observedMaxViews = Math.max(0, ...viewsById.values());
  const observedMaxEnquiry = Math.max(0, ...enquiryByTitle.values());
  const dynamicCaps = {
    ...DEFAULT_CAPS,
    courseViews90d: Math.max(MIN_DYNAMIC_CAP.courseViews90d, observedMaxViews),
    enquiryCount90d: Math.max(MIN_DYNAMIC_CAP.enquiryCount90d, observedMaxEnquiry),
  };

  const now = new Date();
  const bulkOps = [];

  for (const course of targets) {
    const enquiryCount90d = enquiryByTitle.get(course.courseTitle) || 0;
    const orderRevenue90d = revenueById.get(course.id) || 0;
    const courseViews90d = viewsById.get(course.id) || 0;
    const lastBlogGeneratedAt = lastBlogBySlug.get(course.courseSlug) || null;
    const daysSinceLastBlog = lastBlogGeneratedAt
      ? Math.floor((now - new Date(lastBlogGeneratedAt)) / (24 * 60 * 60 * 1000))
      : null;

    const { score, tier } = computeCoursePriorityScore(
      {
        enquiryCount90d,
        orderRevenue90d,
        courseViews90d,
        gscClicks28d: 0,
        gscImpressions28d: 0,
        daysSinceLastBlog,
      },
      weights,
      dynamicCaps
    );

    bulkOps.push({
      updateOne: {
        filter: { courseSlug: course.courseSlug },
        update: {
          $set: {
            courseId: course.id || null,
            priorityScore: score,
            priorityTier: tier,
            lastPriorityComputedAt: now,
          },
          $setOnInsert: { frequency: "WEEKLY", enabled: true },
        },
        upsert: true,
      },
    });
  }

  if (bulkOps.length) {
    await CourseContentSettings.bulkWrite(bulkOps, { ordered: false });
  }

  return { evaluated: targets.length, updated: bulkOps.length, gscGa4Available: GSC_GA4_AVAILABLE };
}

// Returns the "effective" priority score/tier for a settings doc — prefers
// the admin priorityOverride when set, otherwise the computed value.
export function effectivePriority(courseContentSettingsDoc) {
  if (!courseContentSettingsDoc) return { score: 0, tier: "TIER_4_LONG_TAIL" };
  if (courseContentSettingsDoc.priorityOverride != null) {
    const score = courseContentSettingsDoc.priorityOverride;
    const tier = score >= 75 ? "TIER_1_STRATEGIC" : score >= 50 ? "TIER_2_GROWTH" : score >= 25 ? "TIER_3_EVERGREEN" : "TIER_4_LONG_TAIL";
    return { score, tier };
  }
  return { score: courseContentSettingsDoc.priorityScore, tier: courseContentSettingsDoc.priorityTier };
}
