import express from "express";
import { authenticateAdmin, requireAdmin, requireMarketing, requirePage } from "../middleware/authenticateAdmin.js";
import { contentFactoryAiLimiter } from "../middleware/contentFactoryAiLimiter.js";

import { getDashboardStats, getSettings, updateSettings, getUsage } from "../controllers/courseFactory/courseFactorySettings.controller.js";
import { listCourses, generateBlueprint, approveBlueprint, getCourseProduction, publishCourse } from "../controllers/courseFactory/courseBlueprint.controller.js";
import { generateLesson, getGenerationJob, listLessonJobs, retryGenerationJob, regenerateLessonComponent, regenerateSlideAudio } from "../controllers/courseFactory/lessonGeneration.controller.js";
import { getLesson, updateLesson, runQa, submitForReview, approveLesson, publishLesson, verifySource, unverifySource } from "../controllers/courseFactory/lessonReview.controller.js";

const router = express.Router();

// Every route requires admin-panel auth + the course-factory page permission
// (mirrors contentFactory.routes.js).
router.use(authenticateAdmin, requirePage("course-factory"));

// ── Dashboard & Settings ─────────────────────────────────────────────────────
router.get("/dashboard", requireMarketing, getDashboardStats);
router.get("/settings", requireMarketing, getSettings);
router.patch("/settings", requireAdmin, updateSettings);
router.get("/usage", requireAdmin, getUsage);

// ── Courses & Blueprint ───────────────────────────────────────────────────────
router.get("/courses", requireMarketing, listCourses);
router.get("/courses/:id", requireMarketing, getCourseProduction);
router.post("/blueprint/generate", requireMarketing, contentFactoryAiLimiter, generateBlueprint);
router.post("/blueprint/approve", requireAdmin, approveBlueprint);
router.post("/courses/:id/publish", requireAdmin, publishCourse);

// ── Lessons — generation ──────────────────────────────────────────────────────
router.post("/lessons/:id/generate", requireMarketing, contentFactoryAiLimiter, generateLesson);
router.post("/lessons/:id/regenerate", requireMarketing, contentFactoryAiLimiter, regenerateLessonComponent);
router.post("/lessons/:id/slides/:slideOrder/regenerate-audio", requireMarketing, contentFactoryAiLimiter, regenerateSlideAudio);
router.get("/lessons/:id/jobs", requireMarketing, listLessonJobs);
router.get("/jobs/:id", requireMarketing, getGenerationJob);
router.post("/jobs/:id/retry", requireMarketing, contentFactoryAiLimiter, retryGenerationJob);

// ── Lessons — review & publish ────────────────────────────────────────────────
router.get("/lessons/:id", requireMarketing, getLesson);
router.patch("/lessons/:id", requireMarketing, updateLesson);
router.post("/lessons/:id/qa", requireMarketing, runQa);
router.post("/lessons/:id/submit-review", requireMarketing, submitForReview);
router.post("/lessons/:id/approve", requireAdmin, approveLesson);
router.post("/lessons/:id/publish", requireAdmin, publishLesson);

// ── Lessons — source verification (admin-only; never AI-automated) ───────────
router.post("/lessons/:id/sources/:sourceId/verify", requireAdmin, verifySource);
router.post("/lessons/:id/sources/:sourceId/unverify", requireAdmin, unverifySource);

export default router;
