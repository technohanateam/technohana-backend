import express from "express";
import { emailSkillsGapPlan } from "../controllers/skillsGap.controller.js";

const router = express.Router();

router.post("/skills-gap/email-plan", emailSkillsGapPlan);

export default router;
