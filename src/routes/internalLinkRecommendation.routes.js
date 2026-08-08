import express from "express";
import { authenticateAdmin, requirePage } from "../middleware/authenticateAdmin.js";
import { recommendForBlog, recommendForCourse } from "../controllers/internalLinkRecommendation.controller.js";

const router = express.Router();

router.use(authenticateAdmin);

router.get("/blog/:blogId", requirePage("seo-internal-links"), recommendForBlog);
router.get("/course/:courseId", requirePage("seo-internal-links"), recommendForCourse);

export default router;
