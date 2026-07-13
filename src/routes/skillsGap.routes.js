import express from "express";
import rateLimit from "express-rate-limit";
import { emailSkillsGapPlan } from "../controllers/skillsGap.controller.js";

const router = express.Router();

// Each request generates a PDF and sends an email — throttle to limit abuse/cost.
const emailPlanLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

router.post("/skills-gap/email-plan", emailPlanLimiter, emailSkillsGapPlan);

export default router;
