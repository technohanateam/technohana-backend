import express from "express";
import rateLimit from "express-rate-limit";
import xss from "xss";
import QuestionComment from "../models/questionComment.model.js";
import { authenticateJWT } from "../middleware/authenticateJWT.js";
import { verifyCaptcha } from "../utils/verifyCaptcha.js";

const router = express.Router();

// Keyed by user id (route is behind authenticateJWT), so shared IPs don't collide.
const postLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  message: { message: "You're commenting too fast. Please try again in a few minutes." },
});

// GET /api/question-comments/:examCode — all comments for an exam, newest first
router.get("/:examCode", async (req, res) => {
  try {
    const comments = await QuestionComment.find({ examCode: String(req.params.examCode).toUpperCase() })
      .sort({ createdAt: -1 })
      .limit(1000)
      .select("questionKey name picture text createdAt")
      .lean();
    return res.json({ data: comments });
  } catch (err) {
    console.error("Question comments list error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /api/question-comments — registered users only, captcha required
router.post("/", authenticateJWT, postLimiter, async (req, res) => {
  try {
    const { examCode, questionKey, text, captchaToken } = req.body;
    const clean = xss(String(text || "")).trim();

    if (!examCode || !questionKey || !clean) {
      return res.status(400).json({ message: "Comment text is required." });
    }
    if (clean.length > 1000) {
      return res.status(400).json({ message: "Comments are limited to 1000 characters." });
    }
    if (!(await verifyCaptcha(captchaToken, req.ip))) {
      return res.status(400).json({ message: "Captcha verification failed. Please try again." });
    }

    const comment = await QuestionComment.create({
      examCode: String(examCode),
      questionKey: String(questionKey).slice(0, 40),
      userId: req.user.id,
      name: req.user.name || "Learner",
      picture: req.user.picture || null,
      text: clean,
    });

    return res.status(201).json({
      data: {
        _id: comment._id,
        questionKey: comment.questionKey,
        name: comment.name,
        picture: comment.picture,
        text: comment.text,
        createdAt: comment.createdAt,
      },
    });
  } catch (err) {
    console.error("Question comment create error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
