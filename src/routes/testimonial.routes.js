import express from "express";
import rateLimit from "express-rate-limit";
import Testimonial from "../models/testimonial.model.js";

const router = express.Router();

const testimonialLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /testimonial — public submission
router.post("/testimonial", testimonialLimiter, async (req, res) => {
  try {
    const { name, email, courseTitle, rating, review, linkedinUrl, canPublish } = req.body;
    if (!name || !email || !courseTitle || !rating || !review) {
      return res.status(400).json({ message: "All required fields must be filled." });
    }
    const ratingNum = Number(rating);
    if (!EMAIL_RE.test(String(email)) || !Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: "Please provide a valid email and a rating between 1 and 5." });
    }
    if (String(name).length > 100 || String(courseTitle).length > 200 || String(review).length > 2000 || String(linkedinUrl || "").length > 300) {
      return res.status(400).json({ message: "One or more fields are too long." });
    }
    const t = new Testimonial({ name, email, courseTitle, rating: ratingNum, review, linkedinUrl, canPublish });
    await t.save();
    return res.status(201).json({ message: "Thank you! Your testimonial has been submitted for review." });
  } catch (err) {
    console.error("Testimonial submit error:", err);
    return res.status(500).json({ message: "Server error. Please try again." });
  }
});

export default router;
