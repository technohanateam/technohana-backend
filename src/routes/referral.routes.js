import express from "express"
import { authenticateJWT } from "../middleware/authenticateJWT.js"
import {
  generateReferralCode,
  validateAndApplyReferralCode,
  getReferralStats,
  getUserReferralDetails
} from "../controllers/referral.controller.js"

const router = express.Router()

// Generate a unique referral code for authenticated user
router.post("/generate", authenticateJWT, generateReferralCode)

// Validate and apply referral code during signup (public endpoint)
router.post("/validate", validateAndApplyReferralCode)

// Get referral statistics for authenticated user's dashboard
router.get("/stats", authenticateJWT, getReferralStats)

// Get user's referral details (including if they were referred)
router.get("/details", authenticateJWT, getUserReferralDetails)

export default router
