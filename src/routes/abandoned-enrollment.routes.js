import express from "express"
import { authenticateJWT } from "../middleware/authenticateJWT.js"
import { authenticateAdmin, requirePage } from "../middleware/authenticateAdmin.js"
import {
  saveEnrollmentFormProgress,
  markFormAbandoned,
  sendEnrollmentReminder,
  getAbandonedEnrollments,
  clearEnrollmentFormData,
  getEnrollmentFormProgress
} from "../controllers/abandoned-enrollment.controller.js"

const router = express.Router()

// Save/update enrollment form progress (called on every field change)
router.post("/save-progress", authenticateJWT, saveEnrollmentFormProgress)

// Get saved form progress (to resume enrollment form)
router.get("/progress", authenticateJWT, getEnrollmentFormProgress)

// Mark form as abandoned (called when user leaves without enrolling — intentionally public)
router.post("/mark-abandoned", markFormAbandoned)

// Send reminder email for abandoned enrollments (manual trigger or scheduled job)
router.post("/send-reminder", authenticateJWT, sendEnrollmentReminder)

// Get all abandoned enrollments (admin only — contains PII)
router.get("/abandoned-list", authenticateAdmin, requirePage("enrollments"), getAbandonedEnrollments)

// Clear form data after successful enrollment
router.delete("/clear", authenticateJWT, clearEnrollmentFormData)

export default router
