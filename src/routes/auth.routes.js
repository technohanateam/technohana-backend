// routes/auth.routes.js

import express from "express";
import passport from "passport";
import { generateToken, verifyToken } from "../config/jwt.js";
import { User } from "../models/user.model.js";

const router = express.Router();

// The initial call to Google
router.get(
  "/api/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false }) // Tell passport not to create a session
);

router.get(
  "/api/auth/google/callback",
  // Tell passport not to create a session here either
  passport.authenticate("google", { session: false, failureRedirect: "/login-failed" }),
  (req, res) => {
    // Passport has successfully authenticated the user and attached it to req.user
    // Now, we generate our own JWT
    const token = generateToken(req.user);

    // Debug: Log environment variables
    console.log('Environment variables:', {
      WHITELISTED_URLS: process.env.WHITELISTED_URLS,
    });

    // Redirect back to the frontend with our token
    const frontendUrl = process.env.WHITELISTED_URLS;
    console.log('Redirecting to:', `${frontendUrl}/auth/callback?token=${token}`);
    
    res.redirect(
      `${frontendUrl}/auth/callback?token=${token}`
    ); 
  }
);

// Get current authenticated user (by JWT)
router.get("/auth/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ message: "Invalid token" });

    const user = await User.findById(payload.id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({ user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});


router.put("/kyc", async (req, res) => { // Changed from POST to PUT and simplified the path
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const payload = verifyToken(token); // Assuming you have a verifyToken function
    if (!payload) return res.status(401).json({ message: "Invalid token" });

    const { phone, userType, company } = req.body || {};
    if (!phone || !userType) {
      return res
        .status(400)
        .json({ message: "Both phone and userType are required" });
    }

    const updated = await User.findByIdAndUpdate(
      payload.id,
      {
        phone,
        userType,
        company: company || undefined,
        isKyc: true
      },
      { new: true }
    ).lean();

    // Issue a fresh token carrying the updated isKyc flag
    const newToken = generateToken(updated);

    return res.status(200).json({ user: updated, token: newToken, message: "KYC updated" });
  } catch (err) {
    console.error("KYC Update Failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;