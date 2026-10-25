// routes/auth.routes.js

import crypto from "crypto";
import express from "express";
import passport from "passport";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { generateToken, verifyToken } from "../config/jwt.js";
import { User } from "../models/user.model.js";
import { AuthChallenge } from "../models/authChallenge.model.js";
import { authenticateJWT } from "../middleware/authenticateJWT.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateMagicLinkEmail } from "../utils/emailTemplate.js";
import { normalizePhone } from "../utils/phone.js";
import { sendLoginCode, isWhatsAppConfigured } from "../services/whatsapp.js";

const router = express.Router();

const getFrontendUrl = () => process.env.FRONTEND_URL ||
  (process.env.WHITELISTED_URLS ? process.env.WHITELISTED_URLS.split(',')[0].trim() : '');

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const hmac = (s) => crypto.createHmac("sha256", process.env.JWT_SECRET).update(s).digest("hex");
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const limiter = (windowMs, max, message, keyGenerator) => rateLimit({
  windowMs, max, keyGenerator,
  message: { message },
  standardHeaders: true,
  legacyHeaders: false,
});

const magicLinkLimiter = limiter(15 * 60 * 1000, 10, "Too many sign-in requests, please try again later");
const otpIpLimiter = limiter(15 * 60 * 1000, 10, "Too many code requests, please try again later");
const otpPhoneLimiter = limiter(60 * 60 * 1000, 5, "Too many code requests for this number, please try again later",
  (req) => normalizePhone(req.body?.phone) || ipKeyGenerator(req.ip));
const verifyLimiter = limiter(15 * 60 * 1000, 20, "Too many attempts, please try again later");

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many token refresh requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// The initial call to Google
router.get(
  "/api/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false }) // Tell passport not to create a session
);

router.get("/api/auth/google/callback", (req, res, next) => {
  const frontendUrl = getFrontendUrl();

  // Custom callback (rather than the failureRedirect option) so both an auth error
  // (done(err)) and a denied-consent (done(null, false)) result redirect to the
  // frontend instead of one of them falling through to the global JSON error handler.
  passport.authenticate("google", { session: false }, (err, user) => {
    if (err || !user) {
      if (err) console.error("Google authentication failed:", err);
      return res.redirect(`${frontendUrl}/auth/callback`);
    }

    try {
      // Passport has successfully authenticated the user
      // Now, we generate our own JWT
      const token = generateToken(user);

      // Redirect back to the frontend with our token
      res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
    } catch (tokenErr) {
      console.error("Google callback token generation failed:", tokenErr);
      res.redirect(`${frontendUrl}/auth/callback`);
    }
  })(req, res, next);
});

// Email magic link: request. The link opens a frontend page (not an API GET) that POSTs the
// token to /auth/magic-link/verify, so email-scanner prefetches can't burn the single-use token.
router.post("/auth/magic-link", magicLinkLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }

    const recent = await AuthChallenge.exists({
      kind: "magic", identifier: email, createdAt: { $gt: new Date(Date.now() - RESEND_COOLDOWN_MS) },
    });
    if (!recent) {
      const token = crypto.randomBytes(32).toString("hex");
      await AuthChallenge.deleteMany({ kind: "magic", identifier: email });
      const challenge = await AuthChallenge.create({
        kind: "magic", identifier: email, hash: sha256(token), expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      });

      const result = await sendEmail({
        from: fromAddresses.auth,
        to: email,
        replyTo: "corporate@technohana.in",
        subject: "Your Technohana sign-in link",
        html: generateMagicLinkEmail({ magicUrl: `${getFrontendUrl()}/auth/callback?magic=${token}` }),
      });
      if (result?.error) {
        await AuthChallenge.deleteOne({ _id: challenge._id });
        return res.status(502).json({ message: "Couldn't send the email. Please try again." });
      }
    }

    return res.status(200).json({ message: "If that address is valid, a sign-in link is on its way." });
  } catch (err) {
    console.error("Magic link request failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/magic-link/verify", verifyLimiter, async (req, res) => {
  try {
    const token = String(req.body?.token || "");
    const invalid = () => res.status(401).json({ message: "This link is invalid or has expired" });
    if (!/^[a-f0-9]{64}$/.test(token)) return invalid();

    // findOneAndDelete makes the link single-use even under concurrent clicks.
    const challenge = await AuthChallenge.findOneAndDelete({
      kind: "magic", hash: sha256(token), expiresAt: { $gt: new Date() },
    });
    if (!challenge) return invalid();

    // Same account-selection rule as the Google strategy: enrollment forms leave several docs per email.
    let user = await User.findOne({ email: challenge.identifier })
      .collation({ locale: "en", strength: 2 })
      .sort({ isKyc: -1, createdAt: -1 });
    if (!user) {
      user = await User.create({ name: challenge.identifier.split("@")[0], email: challenge.identifier });
    }

    return res.status(200).json({ token: generateToken(user) });
  } catch (err) {
    console.error("Magic link verify failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// WhatsApp OTP: only numbers already saved on an account can sign in. The response is identical
// whether or not the number is registered, so this can't be used to probe for accounts.
router.post("/auth/whatsapp/otp", otpIpLimiter, otpPhoneLimiter, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone || !/^\+\d{8,15}$/.test(phone)) {
      return res.status(400).json({ message: "Enter a valid phone number" });
    }
    if (!isWhatsAppConfigured() || !process.env.WHATSAPP_OTP_TEMPLATE) {
      return res.status(503).json({ message: "WhatsApp sign-in isn't available right now" });
    }

    const recent = await AuthChallenge.exists({
      kind: "wa_otp", identifier: phone, createdAt: { $gt: new Date(Date.now() - RESEND_COOLDOWN_MS) },
    });
    const user = recent ? null : await User.exists({ phoneE164: phone });
    if (user) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      await AuthChallenge.deleteMany({ kind: "wa_otp", identifier: phone });
      const challenge = await AuthChallenge.create({
        kind: "wa_otp", identifier: phone, hash: hmac(`${phone}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS),
      });
      try {
        await sendLoginCode({ phone, code });
      } catch (err) {
        // e.g. recipient opted out; log it, but keep the response generic.
        console.error("WhatsApp login code failed:", err.message);
        await AuthChallenge.deleteOne({ _id: challenge._id });
      }
    }

    return res.status(200).json({ message: "If this number is registered, we've sent a code on WhatsApp." });
  } catch (err) {
    console.error("WhatsApp OTP request failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/whatsapp/verify", verifyLimiter, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || "").trim();
    const invalid = () => res.status(401).json({ message: "Invalid or expired code" });
    if (!phone || !/^\d{6}$/.test(code)) return invalid();

    // Count the attempt before comparing so parallel guesses can't exceed the cap.
    const challenge = await AuthChallenge.findOneAndUpdate(
      { kind: "wa_otp", identifier: phone, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_OTP_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (!challenge) return invalid();

    if (!safeEqual(challenge.hash, hmac(`${phone}:${code}`))) {
      if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
        await AuthChallenge.deleteOne({ _id: challenge._id });
        return res.status(429).json({ message: "Too many wrong codes. Please request a new one." });
      }
      return invalid();
    }

    const { deletedCount } = await AuthChallenge.deleteOne({ _id: challenge._id });
    if (deletedCount !== 1) return invalid(); // another request already used this code

    const user = await User.findOne({ phoneE164: phone }).sort({ isKyc: -1, createdAt: -1 });
    if (!user) return invalid();

    return res.status(200).json({ token: generateToken(user) });
  } catch (err) {
    console.error("WhatsApp OTP verify failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

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


router.put("/kyc", authenticateJWT, async (req, res) => {
  try {
    const payload = req.user;

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

// Refresh JWT token (mobile-friendly)
router.post("/api/auth/refresh", refreshLimiter, async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    if (!token) return res.status(401).json({ success: false, message: "No token provided" });

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ success: false, message: "Invalid or expired token" });

    const user = await User.findById(payload.id).lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const newToken = generateToken(user);
    return res.status(200).json({ success: true, token: newToken, data: { user } });
  } catch (err) {
    console.error("Token refresh failed:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;