import express from "express"
import { authenticateJWT } from "../middleware/authenticateJWT.js"
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

// Mark form as abandoned (called when user leaves without enrolling)
router.post("/mark-abandoned", markFormAbandoned)

// Send reminder email for abandoned enrollments (manual trigger or scheduled job)
router.post("/send-reminder", authenticateJWT, sendEnrollmentReminder)

// Get all abandoned enrollments (admin endpoint)
router.get("/abandoned-list", getAbandonedEnrollments)

// Clear form data after successful enrollment
router.delete("/clear", authenticateJWT, clearEnrollmentFormData)

export default router
