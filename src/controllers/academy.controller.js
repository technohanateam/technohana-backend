import AcademyCourse from "../models/courseFactory/academyCourse.model.js";
import AcademyModule from "../models/courseFactory/academyModule.model.js";
import AcademyLesson from "../models/courseFactory/academyLesson.model.js";

// Public, unauthenticated routes — only ever return PUBLISHED content, and
// only the fields learners need (no cost/job/QA-internal data leaks).
const PUBLIC_LESSON_FIELDS =
  "slug title description durationMinutes level learningObjectives slides narration quiz exercise lab resources sources transcript order moduleId courseId";

// GET /academy/courses
export const listPublishedCourses = async (req, res) => {
  try {
    const courses = await AcademyCourse.find({ status: "PUBLISHED" })
      .select("slug title subtitle description category level audience estimatedHours skills")
      .lean();
    return res.json({ success: true, data: courses });
  } catch (err) {
    console.error("[Academy] listPublishedCourses error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /academy/courses/:courseSlug
export const getPublishedCourse = async (req, res) => {
  try {
    const course = await AcademyCourse.findOne({ slug: req.params.courseSlug, status: "PUBLISHED" }).lean();
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const modules = await AcademyModule.find({ courseId: course._id }).sort({ order: 1 }).lean();
    const lessons = await AcademyLesson.find({ courseId: course._id, status: "PUBLISHED" })
      .select("slug title description durationMinutes order moduleId")
      .sort({ order: 1 })
      .lean();

    const modulesWithLessons = modules.map((m) => ({
      ...m,
      lessons: lessons.filter((l) => String(l.moduleId) === String(m._id)),
    }));

    return res.json({ success: true, data: { course, modules: modulesWithLessons } });
  } catch (err) {
    console.error("[Academy] getPublishedCourse error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /academy/courses/:courseSlug/lessons/:lessonSlug
export const getPublishedLesson = async (req, res) => {
  try {
    const course = await AcademyCourse.findOne({ slug: req.params.courseSlug, status: "PUBLISHED" }).select("_id title slug").lean();
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const lesson = await AcademyLesson.findOne({ courseId: course._id, slug: req.params.lessonSlug, status: "PUBLISHED" })
      .select(PUBLIC_LESSON_FIELDS)
      .lean();
    if (!lesson) return res.status(404).json({ success: false, message: "Lesson not found" });

    const siblingLessons = await AcademyLesson.find({ moduleId: lesson.moduleId, status: "PUBLISHED" })
      .select("slug title order")
      .sort({ order: 1 })
      .lean();
    const currentIndex = siblingLessons.findIndex((l) => l.slug === lesson.slug);
    const nextLesson = siblingLessons[currentIndex + 1] || null;

    return res.json({ success: true, data: { course, lesson, nextLesson } });
  } catch (err) {
    console.error("[Academy] getPublishedLesson error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
