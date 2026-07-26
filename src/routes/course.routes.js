import express from "express";
import Course from "../models/course.model.js";

const router = express.Router();

// GET /courses — public, returns all courses
router.get("/courses", async (req, res) => {
  try {
    const data = await Course.find({ id: { $not: /^playbook-/i } })
      .sort({ category: 1, id: 1 })
      .lean();
    return res.json(data);
  } catch (err) {
    console.error("Public courses error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /courses/:id — public, returns single course by `id` field
router.get("/courses/:id", async (req, res) => {
  try {
    if (/^playbook-/i.test(req.params.id)) {
      return res.status(404).json({ message: "Course not found." });
    }
    const course = await Course.findOne({ id: req.params.id }).lean();
    if (!course) return res.status(404).json({ message: "Course not found." });
    return res.json(course);
  } catch (err) {
    console.error("Public course by id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
