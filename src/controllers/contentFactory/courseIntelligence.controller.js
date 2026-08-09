import Course from "../../models/course.model.js";
import CourseContentSettings from "../../models/courseContentSettings.model.js";
import { refreshCoursePriorities, effectivePriority } from "../../services/contentFactory/coursePriorityAggregation.service.js";

// GET /admin/content-factory/courses — paginated, filterable, searchable
// join of the course catalog with CourseContentSettings.
export const listCourses = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 25);
    const { tier, frequency, search, enabled } = req.query;

    const courseQuery = {};
    if (search) {
      courseQuery.courseTitle = { $regex: String(search).slice(0, 100), $options: "i" };
    }

    const allCourses = await Course.find(courseQuery, { id: 1, courseSlug: 1, courseTitle: 1, category: 1, categoryGroup: 1, _id: 0 }).lean();
    const slugs = allCourses.filter((c) => c.courseSlug).map((c) => c.courseSlug);

    const settingsDocs = await CourseContentSettings.find({ courseSlug: { $in: slugs } }).lean();
    const settingsBySlug = new Map(settingsDocs.map((s) => [s.courseSlug, s]));

    let merged = allCourses
      .filter((c) => c.courseSlug)
      .map((c) => {
        const settings = settingsBySlug.get(c.courseSlug) || null;
        const priority = effectivePriority(settings);
        return {
          courseId: c.id,
          courseSlug: c.courseSlug,
          courseTitle: c.courseTitle,
          category: c.category,
          categoryGroup: c.categoryGroup,
          priorityScore: priority.score,
          priorityTier: priority.tier,
          priorityOverride: settings?.priorityOverride ?? null,
          frequency: settings?.frequencyOverride || settings?.frequency || "WEEKLY",
          enabled: settings?.enabled ?? true,
          lastBlogGeneratedAt: settings?.lastBlogGeneratedAt || null,
          freshnessStatus: settings?.freshnessStatus || "FRESH",
          lastPriorityComputedAt: settings?.lastPriorityComputedAt || null,
        };
      });

    if (tier) merged = merged.filter((c) => c.priorityTier === tier);
    if (frequency) merged = merged.filter((c) => c.frequency === frequency);
    if (enabled === "true") merged = merged.filter((c) => c.enabled);
    if (enabled === "false") merged = merged.filter((c) => !c.enabled);

    merged.sort((a, b) => b.priorityScore - a.priorityScore);

    const total = merged.length;
    const start = (page - 1) * limit;
    const rows = merged.slice(start, start + limit);

    return res.json({ success: true, data: { rows, total, page, limit } });
  } catch (err) {
    console.error("[ContentFactory] listCourses error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PATCH /admin/content-factory/courses/:courseSlug
export const updateCourseSettings = async (req, res) => {
  try {
    const { courseSlug } = req.params;
    const { priorityOverride, frequencyOverride, enabled } = req.body || {};

    const update = {};
    if (priorityOverride !== undefined) update.priorityOverride = priorityOverride === null ? null : Number(priorityOverride);
    if (frequencyOverride !== undefined) update.frequencyOverride = frequencyOverride || null;
    if (enabled !== undefined) update.enabled = Boolean(enabled);

    const settings = await CourseContentSettings.findOneAndUpdate(
      { courseSlug },
      { $set: update, $setOnInsert: { courseSlug } },
      { new: true, upsert: true }
    );

    return res.json({ success: true, data: settings, message: "Course settings updated" });
  } catch (err) {
    console.error("[ContentFactory] updateCourseSettings error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/courses/recompute-priority
// Body: { courseSlug } to recompute one course, or {} / { all: true } for all.
// Rate-limited via contentFactoryAiLimiter even though it's not an AI call,
// per the plan's caution against abuse (it's still a moderately heavy aggregation).
export const recomputePriority = async (req, res) => {
  try {
    const result = await refreshCoursePriorities({ force: true });
    return res.json({ success: true, data: result, message: "Priorities recomputed" });
  } catch (err) {
    console.error("[ContentFactory] recomputePriority error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
