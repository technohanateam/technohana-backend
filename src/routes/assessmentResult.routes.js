import express from "express";
import { authenticateAdmin, requireAdmin } from "../middleware/authenticateAdmin.js";
import { authenticateJWT } from "../middleware/authenticateJWT.js";
import {
  saveAssessmentResult,
  getMyAssessmentResults,
  getAssessmentResults,
  getAssessmentResultById,
} from "../controllers/assessmentResult.controller.js";

const router = express.Router();

router.post("/api/assessment-results", saveAssessmentResult);
router.get("/api/my-assessment-results", authenticateJWT, getMyAssessmentResults);
router.get("/admin/assessment-results", authenticateAdmin, requireAdmin, getAssessmentResults);
router.get("/admin/assessment-results/:id", authenticateAdmin, requireAdmin, getAssessmentResultById);

export default router;
