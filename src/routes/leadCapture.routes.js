import express from "express";
import rateLimit from "express-rate-limit";
import { capturePersonaLead } from "../controllers/leadCapture.controller.js";

const router = express.Router();

const leadCaptureLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

router.post("/lead-capture", leadCaptureLimiter, capturePersonaLead);

export default router;
