import express from "express"
import rateLimit from "express-rate-limit"
import { authenticateJWT } from "../middleware/authenticateJWT.js"
import {
  generateReferralCode,
  validateAndApplyReferralCode,
  getReferralStats,
  getUserReferralDetails
} from "../controllers/referral.controller.js"

const router = express.Router()

// 5 attempts per IP per 15 minutes — prevents brute-force code enumeration
const referralValidateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many referral code attempts. Please try again later." },
})

// Generate a unique referral code for authenticated user
router.post("/generate", authenticateJWT, generateReferralCode)

// Validate and apply referral code — requires auth so the caller's email is trusted
router.post("/validate", referralValidateLimiter, authenticateJWT, validateAndApplyReferralCode)

// Get referral statistics for authenticated user's dashboard
router.get("/stats", authenticateJWT, getReferralStats)

// Get user's referral details (including if they were referred)
router.get("/details", authenticateJWT, getUserReferralDetails)

export default router
