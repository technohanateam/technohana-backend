import { getOrCreateCourseFactorySettings } from "../../models/courseFactory/courseFactorySettings.model.js";
import AcademyCourse from "../../models/courseFactory/academyCourse.model.js";
import AcademyLesson from "../../models/courseFactory/academyLesson.model.js";
import LessonGenerationJob from "../../models/courseFactory/lessonGenerationJob.model.js";

// GET /admin/course-factory/settings
export const getSettings = async (req, res) => {
  try {
    const settings = await getOrCreateCourseFactorySettings();
    return res.json({ success: true, data: settings });
  } catch (err) {
    console.error("[CourseFactory] getSettings error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PATCH /admin/course-factory/settings
const EDITABLE = ["dailyAiBudgetUsd", "automationStatus", "ttsProvider", "ttsVoice", "ttsLanguage", "defaultModelTier"];
export const updateSettings = async (req, res) => {
  try {
    const settings = await getOrCreateCourseFactorySettings();
    for (const key of EDITABLE) {
      if (req.body?.[key] !== undefined) settings[key] = req.body[key];
    }
    if (req.body?.automationStatus === "ENABLED") {
      settings.pausedReason = null;
      settings.pausedAt = null;
    }
    await settings.save();
    return res.json({ success: true, data: settings, message: "Settings updated" });
  } catch (err) {
    console.error("[CourseFactory] updateSettings error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /admin/course-factory/dashboard
// Stats grid per spec §25.
export const getDashboardStats = async (req, res) => {
  try {
    const [courses, lessons, settings] = await Promise.all([
      AcademyCourse.countDocuments(),
      AcademyLesson.find().select("status assets narration").lean(),
      getOrCreateCourseFactorySettings(),
    ]);

    const byStatus = (status) => lessons.filter((l) => l.status === status).length;

    return res.json({
      success: true,
      data: {
        courses: {
          total: courses,
        },
        lessons: {
          total: lessons.length,
          published: byStatus("PUBLISHED"),
          humanReview: byStatus("HUMAN_REVIEW"),
          aiReviewed: byStatus("AI_REVIEWED"),
          approved: byStatus("APPROVED"),
          draft: byStatus("DRAFT"),
        },
        media: {
          pptxReady: lessons.filter((l) => l.assets?.pptxUrl).length,
          audioReady: lessons.filter((l) => l.narration?.audioUrl).length,
          audioPending: lessons.filter((l) => !l.narration?.audioUrl).length,
        },
        budget: {
          dailyAiBudgetUsd: settings.dailyAiBudgetUsd,
          todaySpendUsd: settings.todaySpendUsd,
          automationStatus: settings.automationStatus,
        },
      },
    });
  } catch (err) {
    console.error("[CourseFactory] getDashboardStats error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /admin/course-factory/usage — financial data, admin-only route.
// Aggregated from LessonGenerationJob's own per-step cost ledger (this
// pipeline's calls aren't routed through AiUsageLog — that log is scoped to
// the blog Content Factory's opportunity/job refs).
export const getUsage = async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const jobs = await LessonGenerationJob.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const totalCostUsd = jobs.reduce((sum, j) => sum + (j.totalCostUsd || 0), 0);
    const totalTokens = jobs.reduce((sum, j) => sum + (j.totalTokens || 0), 0);
    return res.json({ success: true, data: { totalCostUsd, totalTokens, jobCount: jobs.length, jobs } });
  } catch (err) {
    console.error("[CourseFactory] getUsage error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
