import express from "express";
import Testimonial from "../models/testimonial.model.js";

const router = express.Router();

// POST /testimonial — public submission
router.post("/testimonial", async (req, res) => {
  try {
    const { name, email, courseTitle, rating, review, linkedinUrl, canPublish } = req.body;
    if (!name || !email || !courseTitle || !rating || !review) {
      return res.status(400).json({ message: "All required fields must be filled." });
    }
    const t = new Testimonial({ name, email, courseTitle, rating, review, linkedinUrl, canPublish });
    await t.save();
    return res.status(201).json({ message: "Thank you! Your testimonial has been submitted for review." });
  } catch (err) {
    console.error("Testimonial submit error:", err);
    return res.status(500).json({ message: "Server error. Please try again." });
  }
});

export default router;
