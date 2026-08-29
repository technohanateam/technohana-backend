import express from 'express';
import rateLimit from 'express-rate-limit';
import { contactUs, createEnquiry,handleAIRiskReportRequest } from '../controllers/enquiry.controller.js';

const router = express.Router();

// Public form-submission endpoints — trigger emails and (for enquiry/contact-us)
// fire-and-forget Claude lead scoring, so they get a modest per-IP cap.
const enquiryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

router.post('/enquiry', enquiryLimiter, createEnquiry);
router.post('/contact-us', enquiryLimiter, contactUs);
router.post("/ai-risk-report", enquiryLimiter, handleAIRiskReportRequest);


export default router; 