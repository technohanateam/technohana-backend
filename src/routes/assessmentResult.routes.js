import express from "express";
import rateLimit from "express-rate-limit";
import { authenticateAdmin, requireAdmin } from "../middleware/authenticateAdmin.js";
import { authenticateJWT } from "../middleware/authenticateJWT.js";
import {
  saveAssessmentResult,
  getMyAssessmentResults,
  getAssessmentResults,
  getAssessmentResultById,
} from "../controllers/assessmentResult.controller.js";

const router = express.Router();

const assessmentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

router.post("/api/assessment-results", assessmentLimiter, saveAssessmentResult);
router.get("/api/my-assessment-results", authenticateJWT, getMyAssessmentResults);
router.get("/admin/assessment-results", authenticateAdmin, requireAdmin, getAssessmentResults);
router.get("/admin/assessment-results/:id", authenticateAdmin, requireAdmin, getAssessmentResultById);

export default router;
