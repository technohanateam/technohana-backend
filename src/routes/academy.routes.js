import express from "express";
import { listPublishedCourses, getPublishedCourse, getPublishedLesson } from "../controllers/academy.controller.js";

// Public, unauthenticated — same intentional-public-route category as
// pricing/quote and coupon validation (see backend CLAUDE.md's Auth section).
// Read-only: only ever returns status: PUBLISHED content.
const router = express.Router();

router.get("/courses", listPublishedCourses);
router.get("/courses/:courseSlug", getPublishedCourse);
router.get("/courses/:courseSlug/lessons/:lessonSlug", getPublishedLesson);

export default router;
