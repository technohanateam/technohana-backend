import express from 'express';
import { contactUs, createEnquiry,handleAIRiskReportRequest } from '../controllers/enquiry.controller.js';

const router = express.Router();

router.post('/enquiry', createEnquiry);
router.post('/contact-us',contactUs);
router.post("/ai-risk-report", handleAIRiskReportRequest);


export default router; 