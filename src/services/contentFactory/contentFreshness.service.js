// Milestone 5 — weekly freshness scan. READ-ONLY classification of
// published Blogs docs into FRESH / REVIEW_RECOMMENDED / OUTDATED, aggregated
// up to CourseContentSettings.freshnessStatus per course. Never edits blog
// `content` — flags for human review elsewhere, never touches the article
// itself, per the plan.
import { Blogs } from "../../models/blogs.model.js";
import Course from "../../models/course.model.js";
import CourseContentSettings from "../../models/courseContentSettings.model.js";
import ContentOpportunity from "../../models/contentOpportunity.model.js";
import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";

const DEFAULT_THRESHOLDS = {
  standard: { freshDays: 90, reviewDays: 180 },
  // Sensitive content (keyword match) ages out faster — a blog about "GPT"
  // or "AWS pricing" goes stale much quicker than an evergreen "what is
  // project management" guide.
  sensitive: { freshDays: 45, reviewDays: 120 },
};

const STATUS_RANK = { FRESH: 0, REVIEW_RECOMMENDED: 1, OUTDATED: 2 };

// PURE function — no DB/network. Trivially unit-testable with plain objects.
export function classifyBlogFreshness(blog, keywords = [], now = new Date()) {
  const baseDate = blog.lastReviewedAt || blog.updatedAt || blog.createdAt || now;
  const ageDays = Math.max(0, (now - new Date(baseDate)) / (24 * 60 * 60 * 1000));

  const haystack = `${blog.category || ""} ${(blog.tags || []).join(" ")} ${blog.title || ""}`.toLowerCase();
  const isSensitive = keywords.some((kw) => haystack.includes(String(kw).toLowerCase()));

  const thresholds = isSensitive ? DEFAULT_THRESHOLDS.sensitive : DEFAULT_THRESHOLDS.standard;
  let status;
  if (ageDays <= thresholds.freshDays) status = "FRESH";
  else if (ageDays <= thresholds.reviewDays) status = "REVIEW_RECOMMENDED";
  else status = "OUTDATED";

  return { status, ageDays: Math.round(ageDays), isSensitive };
}

// PURE function — no DB/network. Reduces multiple blog statuses for the same
// course down to the single worst status (OUTDATED beats REVIEW_RECOMMENDED
// beats FRESH) — one stale post is enough to flag a course for review.
export function worstStatus(statuses = []) {
  if (statuses.length === 0) return null;
  return statuses.reduce((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), statuses[0]);
}

export async function runFreshnessScan() {
  const settings = await getOrCreateContentFactorySettings();
  const keywords = settings.freshnessSensitiveKeywords?.length
    ? settings.freshnessSensitiveKeywords
    : ["AI", "GPT", "Claude", "certification", "pricing", "AWS", "Azure", "GCP"];

  const [blogs, opportunities, courses] = await Promise.all([
    Blogs.find(
      { published: true },
      { title: 1, category: 1, tags: 1, updatedAt: 1, createdAt: 1, lastReviewedAt: 1, sourceOpportunityId: 1 }
    ).lean(),
    ContentOpportunity.find({ resultingBlogId: { $ne: null } }, { resultingBlogId: 1, courseSlug: 1 }).lean(),
    Course.find({}, { courseSlug: 1, category: 1, _id: 0 }).lean(),
  ]);

  const now = new Date();

  // Opportunity-derived linkage: a blog links to a course via
  // sourceOpportunityId -> ContentOpportunity.courseSlug.
  const opportunityById = new Map(opportunities.map((o) => [String(o._id), o.courseSlug]));

  // Best-effort fallback for blogs with no sourceOpportunityId (pre-factory
  // content, or manually authored): match blog.category to every course
  // sharing that exact category (case-insensitive). A blog with a category
  // that matches no course's category contributes to no course's freshness
  // score — it's still classified (for reporting) but doesn't move any
  // CourseContentSettings doc, since there's no reliable course to attribute
  // it to.
  const coursesByCategory = new Map();
  for (const c of courses) {
    if (!c.category || !c.courseSlug) continue;
    const key = c.category.toLowerCase().trim();
    const list = coursesByCategory.get(key) || [];
    list.push(c.courseSlug);
    coursesByCategory.set(key, list);
  }

  const statusesByCourse = new Map(); // courseSlug -> string[] of statuses
  const statusCounts = { FRESH: 0, REVIEW_RECOMMENDED: 0, OUTDATED: 0 };
  let unmatchedBlogs = 0;

  for (const blog of blogs) {
    const { status } = classifyBlogFreshness(blog, keywords, now);
    statusCounts[status] += 1;

    let courseSlugs = [];
    if (blog.sourceOpportunityId && opportunityById.has(String(blog.sourceOpportunityId))) {
      const slug = opportunityById.get(String(blog.sourceOpportunityId));
      if (slug) courseSlugs = [slug];
    }
    if (courseSlugs.length === 0 && blog.category) {
      courseSlugs = coursesByCategory.get(blog.category.toLowerCase().trim()) || [];
    }

    if (courseSlugs.length === 0) {
      unmatchedBlogs += 1;
      continue;
    }

    for (const slug of courseSlugs) {
      const list = statusesByCourse.get(slug) || [];
      list.push(status);
      statusesByCourse.set(slug, list);
    }
  }

  let coursesUpdated = 0;
  const bulkOps = [];
  for (const [courseSlug, statuses] of statusesByCourse.entries()) {
    const finalStatus = worstStatus(statuses);
    bulkOps.push({
      updateOne: {
        filter: { courseSlug },
        update: { $set: { freshnessStatus: finalStatus, lastFreshnessCheckedAt: now }, $setOnInsert: { courseSlug } },
        upsert: true,
      },
    });
  }
  if (bulkOps.length > 0) {
    const result = await CourseContentSettings.bulkWrite(bulkOps, { ordered: false });
    coursesUpdated = (result.modifiedCount || 0) + (result.upsertedCount || 0);
  }

  return {
    scannedBlogs: blogs.length,
    coursesUpdated,
    statusCounts,
    unmatchedBlogs,
    scannedAt: now,
  };
}
