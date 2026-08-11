import AcademyCourse from "../../models/courseFactory/academyCourse.model.js";
import AcademyModule from "../../models/courseFactory/academyModule.model.js";
import AcademyLesson from "../../models/courseFactory/academyLesson.model.js";
import { generateCourseBlueprint } from "../../services/courseFactory/blueprintGenerator.service.js";

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// GET /admin/course-factory/courses
export const listCourses = async (req, res) => {
  try {
    const courses = await AcademyCourse.find().sort({ createdAt: -1 }).lean();
    const courseIds = courses.map((c) => c._id);
    const lessons = await AcademyLesson.find({ courseId: { $in: courseIds } })
      .select("courseId status assets narration qa")
      .lean();

    const data = courses.map((course) => {
      const courseLessons = lessons.filter((l) => String(l.courseId) === String(course._id));
      return {
        ...course,
        stats: {
          lessonCount: courseLessons.length,
          published: courseLessons.filter((l) => l.status === "PUBLISHED").length,
          humanReview: courseLessons.filter((l) => l.status === "HUMAN_REVIEW").length,
          draft: courseLessons.filter((l) => l.status === "DRAFT").length,
          pptxReady: courseLessons.filter((l) => l.assets?.pptxUrl).length,
          audioReady: courseLessons.filter((l) => l.narration?.audioSummary?.allComplete).length,
        },
      };
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[CourseFactory] listCourses error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/course-factory/blueprint/generate
// Generates a draft blueprint only — does NOT persist Course/Module/Lesson
// docs yet. The admin reviews/edits, then POSTs it to /blueprint/approve.
export const generateBlueprint = async (req, res) => {
  try {
    const { title, audience, level, durationHours, moduleCount, lessonsPerModule, technology, teachingStyle } = req.body || {};
    if (!title || !audience || !level) {
      return res.status(400).json({ success: false, message: "title, audience, and level are required" });
    }
    const { blueprint, costUsd } = await generateCourseBlueprint({ title, audience, level, durationHours, moduleCount, lessonsPerModule, technology, teachingStyle });
    return res.json({
      success: true,
      data: { title, audience, level, durationHours, moduleCount, lessonsPerModule, technology, teachingStyle, blueprint, costUsd },
    });
  } catch (err) {
    console.error("[CourseFactory] generateBlueprint error:", err);
    return res.status(500).json({ success: false, message: err.message || "Blueprint generation failed" });
  }
};

// POST /admin/course-factory/blueprint/approve
// Persists the (admin-edited) blueprint as Course + Module + Lesson skeleton
// docs, all in DRAFT status. No lesson content is generated here.
export const approveBlueprint = async (req, res) => {
  try {
    const { title, audience, level, durationHours, moduleCount, lessonsPerModule, technology, teachingStyle, blueprint, costUsd } = req.body || {};
    if (!blueprint || !Array.isArray(blueprint.modules)) {
      return res.status(400).json({ success: false, message: "blueprint.modules is required" });
    }

    const slug = slugify(title);
    const existing = await AcademyCourse.findOne({ slug });
    if (existing) return res.status(409).json({ success: false, message: `A course with slug "${slug}" already exists` });

    const course = await AcademyCourse.create({
      slug,
      title,
      subtitle: blueprint.subtitle || "",
      description: blueprint.description || "",
      category: blueprint.category || "",
      level,
      audience,
      estimatedHours: durationHours || 0,
      learningObjectives: blueprint.learningObjectives || [],
      skills: blueprint.skills || [],
      capstone: blueprint.capstone || {},
      blueprintInput: { audience, level, durationHours, moduleCount, lessonsPerModule, technology, teachingStyle },
      blueprintCostUsd: costUsd || 0,
      status: "APPROVED",
      approvedBy: req.admin?.uid || null,
      approvedAt: new Date(),
      createdBy: req.admin?.uid || null,
    });

    const moduleIds = [];
    for (let mIdx = 0; mIdx < blueprint.modules.length; mIdx++) {
      const modInput = blueprint.modules[mIdx];
      const module = await AcademyModule.create({
        courseId: course._id,
        title: modInput.title,
        description: modInput.description || "",
        order: mIdx + 1,
        learningObjectives: modInput.learningObjectives || [],
      });

      const lessonIds = [];
      for (let lIdx = 0; lIdx < (modInput.lessons || []).length; lIdx++) {
        const lessonInput = modInput.lessons[lIdx];
        const lesson = await AcademyLesson.create({
          moduleId: module._id,
          courseId: course._id,
          slug: `${slugify(lessonInput.title)}`,
          order: lIdx + 1,
          title: lessonInput.title,
          description: lessonInput.description || "",
          durationMinutes: lessonInput.durationMinutes || 15,
          level,
          status: "DRAFT",
        });
        lessonIds.push(lesson._id);
      }
      module.lessonIds = lessonIds;
      await module.save();
      moduleIds.push(module._id);
    }

    course.moduleIds = moduleIds;
    await course.save();

    return res.json({ success: true, data: { courseId: course._id, slug: course.slug }, message: "Blueprint approved and persisted" });
  } catch (err) {
    console.error("[CourseFactory] approveBlueprint error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /admin/course-factory/courses/:id
export const getCourseProduction = async (req, res) => {
  try {
    const course = await AcademyCourse.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const modules = await AcademyModule.find({ courseId: course._id }).sort({ order: 1 }).lean();
    const lessons = await AcademyLesson.find({ courseId: course._id }).sort({ order: 1 }).lean();

    const modulesWithLessons = modules.map((m) => ({
      ...m,
      lessons: lessons.filter((l) => String(l.moduleId) === String(m._id)),
    }));

    const lessonsCostUsd = lessons.reduce((sum, l) => sum + (l.costUsd?.totalUsd || 0), 0);
    const costSummary = {
      blueprintCostUsd: course.blueprintCostUsd || 0,
      lessonsCostUsd,
      totalCostUsd: (course.blueprintCostUsd || 0) + lessonsCostUsd,
    };

    return res.json({ success: true, data: { course, modules: modulesWithLessons, costSummary } });
  } catch (err) {
    console.error("[CourseFactory] getCourseProduction error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PATCH /admin/course-factory/courses/:id/publish
// Publishes the course record itself once its lessons are published (does
// NOT cascade-publish lessons — each lesson is published individually via
// lessonReview.controller.js after human approval, spec §23).
export const publishCourse = async (req, res) => {
  try {
    const course = await AcademyCourse.findById(req.params.id);
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const publishedCount = await AcademyLesson.countDocuments({ courseId: course._id, status: "PUBLISHED" });
    if (publishedCount === 0) {
      return res.status(409).json({ success: false, message: "Publish at least one lesson before publishing the course" });
    }

    course.status = "PUBLISHED";
    course.publishedAt = new Date();
    await course.save();
    return res.json({ success: true, message: "Course published" });
  } catch (err) {
    console.error("[CourseFactory] publishCourse error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
