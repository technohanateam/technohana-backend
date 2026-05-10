
import dotenv from "dotenv";

// --- LOAD ENV BEFORE OTHER IMPORTS ---
dotenv.config();

import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";

import express from "express";
import cors from "cors";
import crypto from "crypto";
import passport from "passport";
import Stripe from "stripe";
import Razorpay from "razorpay";
import { sendEmail, fromAddresses } from "./config/emailService.js";
import { generateEnrollmentDetailsForSales, generatePaymentSuccessEmail, generateAbandonedCartEmail, generateDay3Email, generateDay7Email } from "./utils/emailTemplate.js";
const stripe = new Stripe(process.env.STRIPE_SECRET);
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- CONFIGURATION ---
import "./config/passport.js";

import connectDb from "./config/db.js";
import { User } from "./models/user.model.js";
import enquiryRoutes from "./routes/enquiry.routes.js";
import enrollmentRoutes from "./routes/enrollment.route.js";
import subscriptionRoutes from "./routes/subscription.routes.js";
import authRoutes from "./routes/auth.routes.js";
import blogRoutes from "./routes/blog.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import courseRoutes from "./routes/course.routes.js";
import referralRoutes from "./routes/referral.routes.js";
import abandonedEnrollmentRoutes from "./routes/abandoned-enrollment.routes.js";
import courseViewRoutes from "./routes/courseView.routes.js";
import testimonialRoutes from "./routes/testimonial.routes.js";
import assessmentResultRoutes from "./routes/assessmentResult.routes.js";
import seoGeoRoutes from "./routes/seo-geo.routes.js";
import Coupon from "./models/coupon.model.js";
import { validateCoupon, incrementCouponUsage } from "./controllers/coupon.controller.js";
import { handleResendWebhook } from "./services/resendWebhook.js";
import { registerCampaignEventListeners, emitCampaignEvent } from "./services/campaignEventTrigger.js";
import Enquiry from "./models/enquiry.model.js";
import { authenticateAdmin } from "./middleware/authenticateAdmin.js";
import { authenticateJWT } from "./middleware/authenticateJWT.js";
import { Order } from "./models/order.model.js";
