import express from "express";
import { CourseView } from "../models/courseView.model.js";
import { authenticateAdmin } from "../middleware/authenticateAdmin.js";

const router = express.Router();

// POST /api/course-views — record a view (public, no auth)
router.post("/course-views", async (req, res) => {
  try {
    const { courseId, courseTitle, userEmail, country, currency } = req.body;
    if (!courseId) return res.status(400).json({ success: false, message: "courseId is required" });
    await CourseView.create({ courseId, courseTitle, userEmail, country, currency });
    return res.status(201).json({ success: true });
  } catch (err) {
    console.error("CourseView track error:", err);
    return res.status(500).json({ success: false });
  }
});

// GET /admin/course-views/stats — top courses by view count (admin auth)
router.get("/course-views/stats", authenticateAdmin, async (req, res) => {
  try {
    const [totalViews, topCourses] = await Promise.all([
      CourseView.countDocuments(),
      CourseView.aggregate([
        {
          $group: {
            _id: "$courseId",
            courseTitle: { $last: "$courseTitle" },
            views: { $sum: 1 },
            uniqueEmails: {
              $addToSet: {
                $cond: [{ $ifNull: ["$userEmail", false] }, "$userEmail", "$$REMOVE"],
              },
            },
            lastViewedAt: { $max: "$viewedAt" },
          },
        },
        { $sort: { views: -1 } },
        { $limit: 50 },
        {
          $project: {
            courseId: "$_id",
            courseTitle: 1,
            views: 1,
            uniqueViewers: { $size: "$uniqueEmails" },
            lastViewedAt: 1,
            _id: 0,
          },
        },
      ]),
    ]);

    return res.json({ success: true, totalViews, topCourses });
  } catch (err) {
    console.error("CourseView stats error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /admin/course-views — paginated raw view log (admin auth)
router.get("/course-views", authenticateAdmin, async (req, res) => {
  try {
    const { courseId, page = 1, limit = 20 } = req.query;
    const query = {};
    if (courseId) query.courseId = courseId;

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      CourseView.find(query).sort({ viewedAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      CourseView.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    console.error("CourseView list error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
