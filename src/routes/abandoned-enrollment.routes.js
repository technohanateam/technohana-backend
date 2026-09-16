import express from "express"
import rateLimit, { ipKeyGenerator } from "express-rate-limit"
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

// Public, unauthenticated (fires for anonymous visitors who haven't logged in yet)
const markAbandonedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
})

// Throttles the AI-triggered recovery-email send so a single logged-in user can't
// burn AI/email budget by repeatedly hitting this endpoint (mirrors admin.routes.js's adminAiLimiter pattern).
const sendReminderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: "Too many reminder requests. Please try again later.",
})

// Save/update enrollment form progress (called on every field change)
router.post("/save-progress", authenticateJWT, saveEnrollmentFormProgress)

// Get saved form progress (to resume enrollment form)
router.get("/progress", authenticateJWT, getEnrollmentFormProgress)

// Mark form as abandoned (called when user leaves without enrolling — intentionally public)
router.post("/mark-abandoned", markAbandonedLimiter, markFormAbandoned)

// Send reminder email for abandoned enrollments (manual trigger or scheduled job)
router.post("/send-reminder", authenticateJWT, sendReminderLimiter, sendEnrollmentReminder)

// Get all abandoned enrollments (admin only — contains PII)
router.get("/abandoned-list", authenticateAdmin, requirePage("enrollments"), getAbandonedEnrollments)

// Clear form data after successful enrollment
router.delete("/clear", authenticateJWT, clearEnrollmentFormData)

export default router
