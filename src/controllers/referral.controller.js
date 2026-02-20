import { User } from "../models/user.model.js"
import crypto from "crypto"

// Generate a unique referral code for a user
export const generateReferralCode = async (req, res) => {
  try {
    const email = req.user?.email
    if (!email) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // If user already has a referral code, return it
    if (user.referralCode) {
      return res.status(200).json({
        referralCode: user.referralCode,
        message: "Referral code already exists"
      })
    }

    // Generate unique referral code (8-12 characters, alphanumeric)
    let referralCode = ""
    let isUnique = false
    while (!isUnique) {
      referralCode = crypto.randomBytes(6).toString("hex").toUpperCase().slice(0, 8)
      const existingCode = await User.findOne({ referralCode })
      if (!existingCode) {
        isUnique = true
      }
    }

    user.referralCode = referralCode
    await user.save()

    res.status(200).json({
      referralCode,
      message: "Referral code generated successfully"
    })
  } catch (error) {
    console.error("Error generating referral code:", error)
    res.status(500).json({ message: "Internal server error", error: error.message })
  }
}

// Validate and apply referral code during enrollment/signup
export const validateAndApplyReferralCode = async (req, res) => {
  try {
    const { referralCode, newUserEmail } = req.body

    if (!referralCode || !newUserEmail) {
      return res.status(400).json({ message: "Referral code and new user email are required" })
    }

    // Find the referrer by referral code
    const referrer = await User.findOne({ referralCode })
    if (!referrer) {
      return res.status(404).json({ message: "Invalid referral code" })
    }

    // Check if new user exists
    const newUser = await User.findOne({ email: newUserEmail })
    if (!newUser) {
      return res.status(404).json({ message: "New user not found" })
    }

    // Prevent self-referral
    if (referrer.email === newUserEmail) {
      return res.status(400).json({ message: "Cannot apply your own referral code" })
    }

    // Check if new user already has a referrer
    if (newUser.referredBy) {
      return res.status(400).json({ message: "User already has a referral applied" })
    }

    // Apply referral code to new user
    newUser.referredBy = referrer.email
    newUser.referralDiscountApplied = true
    newUser.referralDiscountPct = 10 // 10% default

    // Increment referral count for referrer
    referrer.referralCount = (referrer.referralCount || 0) + 1

    await newUser.save()
    await referrer.save()

    res.status(200).json({
      message: "Referral code applied successfully",
      discountPct: 10,
      referrerName: referrer.name || referrer.email
    })
  } catch (error) {
    console.error("Error applying referral code:", error)
    res.status(500).json({ message: "Internal server error", error: error.message })
  }
}

// Get referral statistics for dashboard
export const getReferralStats = async (req, res) => {
  try {
    const email = req.user?.email
    if (!email) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    // Get count of users who have used this user's referral code
    const referralsUsed = await User.countDocuments({ referredBy: email })

    // Calculate total discount given (if applicable)
    const totalDiscountGiven = referralsUsed * 10 // 10% discount per referral

    res.status(200).json({
      referralCode: user.referralCode || null,
      referralCount: user.referralCount || 0,
      referralsUsed,
      totalDiscountGiven,
      discountPct: user.referralDiscountPct || 10,
      message: "Referral stats retrieved successfully"
    })
  } catch (error) {
    console.error("Error getting referral stats:", error)
    res.status(500).json({ message: "Internal server error", error: error.message })
  }
}

// Get user referral details (referrer info if referred)
export const getUserReferralDetails = async (req, res) => {
  try {
    const email = req.user?.email
    if (!email) {
      return res.status(401).json({ message: "User not authenticated" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    let referrerDetails = null
    if (user.referredBy) {
      const referrer = await User.findOne({ email: user.referredBy })
      if (referrer) {
        referrerDetails = {
          name: referrer.name || "Anonymous",
          email: referrer.email,
          referralCode: referrer.referralCode
        }
      }
    }

    res.status(200).json({
      referralCode: user.referralCode || null,
      referredBy: user.referredBy || null,
      referrerDetails,
      discountApplied: user.referralDiscountApplied || false,
      discountPct: user.referralDiscountPct || 0
    })
  } catch (error) {
    console.error("Error getting user referral details:", error)
    res.status(500).json({ message: "Internal server error", error: error.message })
  }
}
