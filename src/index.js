// index.js

import dotenv from "dotenv";

// --- LOAD ENV BEFORE OTHER IMPORTS ---
dotenv.config();

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
import Coupon from "./models/coupon.model.js";
import { validateCoupon, incrementCouponUsage } from "./controllers/coupon.controller.js";
import { handleResendWebhook } from "./services/resendWebhook.js";
import { registerCampaignEventListeners, emitCampaignEvent } from "./services/campaignEventTrigger.js";
import Enquiry from "./models/enquiry.model.js";
import { authenticateAdmin } from "./middleware/authenticateAdmin.js";
import { authenticateJWT } from "./middleware/authenticateJWT.js";
import { Order } from "./models/order.model.js";

const app = express();

const allowedOrigins = process.env.WHITELISTED_URLS
  ? process.env.WHITELISTED_URLS.split(',').map(url => url.trim())
  : [];

const corsOption = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-timestamp",
    "x-checksum",
    "Access-Control-Allow-Origin",
  ],
  credentials: true,
};
console.log(process.env.WHITELISTED_URLS);
app.use(cors(corsOption));
app.use(express.json());
// --- Persistent order store via MongoDB (24-hour TTL) ---

const PendingOrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true, index: true },
  provider: { type: String, enum: ['stripe', 'razorpay'] },
  razorpayOrderId: { type: String },
  courseId: { type: String },
  enrollmentType: { type: String },
  participants: { type: Number },
  currency: { type: String },
  basePriceMinor: { type: Number },
  unitAmountMinor: { type: Number },
  quantity: { type: Number },
  expectedTotalMinor: { type: Number },
  enrollmentDiscountPercent: { type: Number },
  couponApplied: { type: Boolean },
  couponCode: { type: String },
  couponDiscountPercent: { type: Number },
  referralCode: { type: String },
  referralDiscountPercent: { type: Number },
  totalDiscountPercent: { type: Number },
  status: { type: String, default: 'pending' },
  paidAt: { type: Number },
  razorpayPaymentId: { type: String },
  cartOrderIds: { type: [String], default: undefined }, // for multi-item cart (Razorpay)
  learner: { type: Object },
  courseInfo: { type: Object },
  utm: { type: Object },
  createdAt: { type: Date, default: Date.now, expires: 86400 },
});
const PendingOrder = mongoose.model('PendingOrder', PendingOrderSchema);

const generateOrderId = () => `ord_${Math.random().toString(36).slice(2, 10)}`;

// --- Pricing utilities (Replace with DB/config-backed logic) ---
const allowedCurrencies = ['usd', 'inr', 'aed', 'eur', 'gbp'];

// Coupon map — single source of truth for both validation and quote computation
// currencies: null means global (any currency); otherwise array of allowed currency codes
const validCoupons = {
  // ── India (INR) ──────────────────────────────────────────────────────────
  'NEWYEAR5':       { rate: 0.05, currencies: null },          // Jan 1  — global
  'SUMMER10':       { rate: 0.10, currencies: null },          // Summer — global
  'REPUBLIC5':      { rate: 0.05, currencies: ['inr'] },       // Jan 26 — Republic Day
  'PONGAL5':        { rate: 0.05, currencies: ['inr'] },       // Jan    — Pongal / Makar Sankranti
  'HOLI5':          { rate: 0.05, currencies: ['inr'] },       // Mar    — Holi
  'BAISAKHI5':      { rate: 0.05, currencies: ['inr'] },       // Apr 14 — Baisakhi
  'INDEPENDENCE8':  { rate: 0.08, currencies: ['inr'] },       // Aug 15 — Independence Day
  'ONAM7':          { rate: 0.07, currencies: ['inr'] },       // Sep    — Onam
  'NAVRATRI8':      { rate: 0.08, currencies: ['inr'] },       // Oct    — Navratri
  'DIWALI10':       { rate: 0.10, currencies: ['inr'] },       // Oct/Nov — Diwali
  // ── UAE / Arab ────────────────────────────────────────────────────────────
  'RAMADAN8':       { rate: 0.08, currencies: ['aed'] },       // Mar/Apr — Ramadan
  'EID10':          { rate: 0.10, currencies: ['aed'] },       // Apr/Jun — Eid ul-Fitr / Adha
  'UAENATIONAL8':   { rate: 0.08, currencies: ['aed'] },       // Dec 2  — UAE National Day
  // ── US ────────────────────────────────────────────────────────────────────
  'MEMORIALDAY5':   { rate: 0.05, currencies: ['usd'] },       // May    — Memorial Day
  'JUNETEENTH5':    { rate: 0.05, currencies: ['usd'] },       // Jun 19 — Juneteenth
  'LABORDAY7':      { rate: 0.07, currencies: ['usd'] },       // Sep    — Labor Day
  'HALLOWEEN5':     { rate: 0.05, currencies: ['usd'] },       // Oct 31 — Halloween
  'THANKSGIVING7':  { rate: 0.07, currencies: ['usd'] },       // Nov    — Thanksgiving
  'XMAS10':         { rate: 0.10, currencies: ['usd', 'gbp', 'eur'] }, // Dec — Christmas
  // ── UK / EU ───────────────────────────────────────────────────────────────
  'STPATRICKS5':    { rate: 0.05, currencies: ['gbp', 'eur'] }, // Mar 17 — St. Patrick's Day
  'EASTER6':        { rate: 0.06, currencies: ['gbp', 'eur'] }, // Apr    — Easter
  'MAYBANK5':       { rate: 0.05, currencies: ['gbp', 'eur'] }, // May    — May Bank Holiday
  'SUMMERLEARN7':   { rate: 0.07, currencies: ['usd', 'gbp', 'eur'] }, // Jun–Aug — Summer Learning
  // ── Global / Platform ─────────────────────────────────────────────────────
  'LAUNCH10':       { rate: 0.10, currencies: null },          // Always-on platform launch
  'FLASHSALE15':    { rate: 0.15, currencies: null },          // On-demand flash sale — activate manually
  'REFERRAL10':     { rate: 0.10, currencies: null },          // Referral campaign codes — activate per campaign
  'B2B20':          { rate: 0.20, currencies: null },          // Corporate / B2B deals — activate per deal
};

const priceCatalog = {
  // Per-course prices in MINOR units (major x 100) per currency
  // Generated via scripts/generate-prices.js using PPP multipliers
  'GENAI101': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'GENAI102': { inr: 2400000, usd: 21900, aed: 89900, gbp: 18900, eur: 21900 },
  'GENAI103': { inr: 1080000, usd: 9900, aed: 40900, gbp: 8900, eur: 9900 },
  'GENAI104': { inr: 9000000, usd: 78900, aed: 333900, gbp: 69900, eur: 81900 },
  'GENAI105': { inr: 960000, usd: 8900, aed: 35900, gbp: 7900, eur: 8900 },
  'GENAI106': { inr: 3000000, usd: 26900, aed: 111900, gbp: 23900, eur: 27900 },
  'GENAI107': { inr: 1800000, usd: 15900, aed: 66900, gbp: 13900, eur: 16900 },
  'GENAI108': { inr: 4020000, usd: 35900, aed: 149900, gbp: 31900, eur: 36900 },
  'GENAI109': { inr: 6000000, usd: 52900, aed: 222900, gbp: 46900, eur: 54900 },
  'GENAI110': { inr: 2640000, usd: 23900, aed: 97900, gbp: 20900, eur: 24900 },
  'GENAI111': { inr: 3360000, usd: 29900, aed: 124900, gbp: 25900, eur: 30900 },
  'GENAI112': { inr: 3840000, usd: 33900, aed: 142900, gbp: 29900, eur: 35900 },
  'GENAI113': { inr: 3360000, usd: 29900, aed: 124900, gbp: 25900, eur: 30900 },
  'GENAI114': { inr: 1800000, usd: 15900, aed: 66900, gbp: 13900, eur: 16900 },
  'DSML101': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'DSML102': { inr: 4032000, usd: 35900, aed: 149900, gbp: 31900, eur: 36900 },
  'DSML103': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'DSML104': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'DSML105': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'DSML106': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'DSML107': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'DSML108': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'DSML109': { inr: 4032000, usd: 35900, aed: 149900, gbp: 31900, eur: 36900 },
  'DSML110': { inr: 4032000, usd: 35900, aed: 149900, gbp: 31900, eur: 36900 },
  'DSML111': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'AR101': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'AR102': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'AR103': { inr: 20160000, usd: 175900, aed: 746900, gbp: 155900, eur: 183900 },
  'AI100STARTUP': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'AR104': { inr: 2688000, usd: 23900, aed: 99900, gbp: 20900, eur: 24900 },
  'CP101': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'CP102': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'CP103': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'CP104': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'GPT101': { inr: 2688000, usd: 23900, aed: 99900, gbp: 20900, eur: 24900 },
  'GPT102': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'GPT103': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'GPT104': { inr: 600000, usd: 5900, aed: 22900, gbp: 4900, eur: 5900 },
  'GPT105': { inr: 672000, usd: 5900, aed: 25900, gbp: 5900, eur: 6900 },
  'GPT106': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'GPT107': { inr: 3000000, usd: 26900, aed: 111900, gbp: 23900, eur: 27900 },
  'GPT108': { inr: 3360000, usd: 29900, aed: 124900, gbp: 25900, eur: 30900 },
  'GPT109': { inr: 2160000, usd: 18900, aed: 80900, gbp: 16900, eur: 19900 },
  'AIPLATFORM101': { inr: 3360000, usd: 29900, aed: 124900, gbp: 25900, eur: 30900 },
  'AIPLATFORM102': { inr: 3840000, usd: 33900, aed: 142900, gbp: 29900, eur: 35900 },
  'AIPLATFORM103': { inr: 3360000, usd: 29900, aed: 124900, gbp: 25900, eur: 30900 },
  'AI-102': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'DP-100': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'AI-900': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'AI-050': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'AI-3002': { inr: 1008000, usd: 8900, aed: 37900, gbp: 7900, eur: 9900 },
  'AI-3003': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'AI-3004': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'DP-3007': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'DP-3014': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'PL-300': { inr: 4032000, usd: 35900, aed: 149900, gbp: 31900, eur: 36900 },
  'AZ-204': { inr: 4032000, usd: 35900, aed: 149900, gbp: 31900, eur: 36900 },
  'AZ-400T00': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'AZ-104T00': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'AZ-500T00': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'SC-300T00': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'AZ-900T00': { inr: 1344000, usd: 11900, aed: 49900, gbp: 10900, eur: 12900 },
  'CRISC': { inr: 7440000, usd: 64900, aed: 275900, gbp: 57900, eur: 67900 },
  'CGEIT': { inr: 7440000, usd: 64900, aed: 275900, gbp: 57900, eur: 67900 },
  'COBIT': { inr: 7440000, usd: 64900, aed: 275900, gbp: 57900, eur: 67900 },
  'ISO31000': { inr: 5580000, usd: 48900, aed: 206900, gbp: 42900, eur: 50900 },
  'AWS-SA-PRO': { inr: 5040000, usd: 43900, aed: 186900, gbp: 38900, eur: 45900 },
  'AWS-DEVOPS-PRO': { inr: 5040000, usd: 43900, aed: 186900, gbp: 38900, eur: 45900 },
  'AWS-CLF-C02': { inr: 2160000, usd: 18900, aed: 80900, gbp: 16900, eur: 19900 },
  'AWS-DVA-C02': { inr: 4200000, usd: 36900, aed: 155900, gbp: 32900, eur: 38900 },
  'AWS-SOA-C02': { inr: 4200000, usd: 36900, aed: 155900, gbp: 32900, eur: 38900 },
  'AWS-SCS-C02': { inr: 5400000, usd: 47900, aed: 200900, gbp: 41900, eur: 49900 },
  'AWS-MLS-C01': { inr: 5760000, usd: 50900, aed: 213900, gbp: 44900, eur: 52900 },
  'AWS-DAS-C01': { inr: 5400000, usd: 47900, aed: 200900, gbp: 41900, eur: 49900 },
  'AWS-ANS-C01': { inr: 5400000, usd: 47900, aed: 200900, gbp: 41900, eur: 49900 },
  'GCP-PCA': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'GCP-ACE': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'GCP-PDE': { inr: 6240000, usd: 54900, aed: 231900, gbp: 48900, eur: 56900 },
  'GCP-PCNE': { inr: 5760000, usd: 50900, aed: 213900, gbp: 44900, eur: 52900 },
  'GCP-PCSE': { inr: 6240000, usd: 54900, aed: 231900, gbp: 48900, eur: 56900 },
  'GCP-MLE': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'GCP-PCD': { inr: 5760000, usd: 50900, aed: 213900, gbp: 44900, eur: 52900 },
  'SC-401': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'AZ-305T00': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'AZ-700': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'AZ-140': { inr: 4560000, usd: 39900, aed: 169900, gbp: 35900, eur: 41900 },
  'AZ-220': { inr: 4560000, usd: 39900, aed: 169900, gbp: 35900, eur: 41900 },
  'DP-203': { inr: 4560000, usd: 39900, aed: 169900, gbp: 35900, eur: 41900 },
  'DP-300': { inr: 4560000, usd: 39900, aed: 169900, gbp: 35900, eur: 41900 },
  'DP-420': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'SC-100': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'SC-200': { inr: 4560000, usd: 39900, aed: 169900, gbp: 35900, eur: 41900 },
  'MS-900': { inr: 2160000, usd: 18900, aed: 80900, gbp: 16900, eur: 19900 },
  'MS-102': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'MS-700': { inr: 4560000, usd: 39900, aed: 169900, gbp: 35900, eur: 41900 },
  'MD-102': { inr: 4560000, usd: 39900, aed: 169900, gbp: 35900, eur: 41900 },
  'PL-200': { inr: 4560000, usd: 39900, aed: 169900, gbp: 35900, eur: 41900 },
  'PL-400': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'ATLS101': { inr: 2640000, usd: 23900, aed: 97900, gbp: 20900, eur: 24900 },
  'ATLS102': { inr: 3840000, usd: 33900, aed: 142900, gbp: 29900, eur: 35900 },
  'ATLS103': { inr: 3360000, usd: 29900, aed: 124900, gbp: 25900, eur: 30900 },
  'ATLS201': { inr: 2160000, usd: 18900, aed: 80900, gbp: 16900, eur: 19900 },
  'ATLS202': { inr: 4200000, usd: 36900, aed: 155900, gbp: 32900, eur: 38900 },
  'ATLS301': { inr: 2160000, usd: 18900, aed: 80900, gbp: 16900, eur: 19900 },
  'ATLS302': { inr: 3000000, usd: 26900, aed: 111900, gbp: 23900, eur: 27900 },
  'ATLS401': { inr: 3360000, usd: 29900, aed: 124900, gbp: 25900, eur: 30900 },
  'ATLS501': { inr: 3840000, usd: 33900, aed: 142900, gbp: 29900, eur: 35900 },
  'ATLS601': { inr: 2640000, usd: 23900, aed: 97900, gbp: 20900, eur: 24900 },
  'ATLS701': { inr: 3360000, usd: 29900, aed: 124900, gbp: 25900, eur: 30900 },
  'ATLS801': { inr: 2640000, usd: 23900, aed: 97900, gbp: 20900, eur: 24900 },
  'SN101': { inr: 3840000, usd: 33900, aed: 142900, gbp: 29900, eur: 35900 },
  'SN102': { inr: 5400000, usd: 47900, aed: 200900, gbp: 41900, eur: 49900 },
  'SN103': { inr: 4560000, usd: 39900, aed: 169900, gbp: 35900, eur: 41900 },
  'SF101': { inr: 5040000, usd: 43900, aed: 186900, gbp: 38900, eur: 45900 },
  'SF102': { inr: 6720000, usd: 58900, aed: 249900, gbp: 51900, eur: 61900 },
  'SF103': { inr: 3840000, usd: 33900, aed: 142900, gbp: 29900, eur: 35900 },
  'SF104': { inr: 4560000, usd: 39900, aed: 169900, gbp: 35900, eur: 41900 },
  'AGILE101': { inr: 2640000, usd: 23900, aed: 97900, gbp: 20900, eur: 24900 },
  'AGILE102': { inr: 4200000, usd: 36900, aed: 155900, gbp: 32900, eur: 38900 },
  'AGILE103': { inr: 6240000, usd: 54900, aed: 231900, gbp: 48900, eur: 56900 },
  'AGILE104': { inr: 2160000, usd: 18900, aed: 80900, gbp: 16900, eur: 19900 },
  'DEVOPS101': { inr: 2400000, usd: 21900, aed: 89900, gbp: 18900, eur: 21900 },
  'DEVOPS102': { inr: 5760000, usd: 50900, aed: 213900, gbp: 44900, eur: 52900 },
  'DEVOPS103': { inr: 3840000, usd: 33900, aed: 142900, gbp: 29900, eur: 35900 },
  'DEVOPS104': { inr: 4200000, usd: 36900, aed: 155900, gbp: 32900, eur: 38900 },
  'DEVOPS105': { inr: 3840000, usd: 33900, aed: 142900, gbp: 29900, eur: 35900 },
  'VIZ101': { inr: 3600000, usd: 31900, aed: 133900, gbp: 27900, eur: 32900 },
  'VIZ102': { inr: 3600000, usd: 31900, aed: 133900, gbp: 27900, eur: 32900 },
  'CY101': { inr: 6240000, usd: 54900, aed: 231900, gbp: 48900, eur: 56900 },
  'CY102': { inr: 5400000, usd: 47900, aed: 200900, gbp: 41900, eur: 49900 },
  'CY103': { inr: 6960000, usd: 60900, aed: 257900, gbp: 53900, eur: 63900 },
  'PYAUTO101': { inr: 3360000, usd: 29900, aed: 124900, gbp: 25900, eur: 30900 },
  'PYAUTO102': { inr: 3600000, usd: 31900, aed: 133900, gbp: 27900, eur: 32900 },
  'PYAUTO103': { inr: 2400000, usd: 21900, aed: 89900, gbp: 18900, eur: 21900 },
  'SAP101': { inr: 3840000, usd: 33900, aed: 142900, gbp: 29900, eur: 35900 },
  'SAP102': { inr: 5040000, usd: 43900, aed: 186900, gbp: 38900, eur: 45900 },
  'GIT101': { inr: 2160000, usd: 18900, aed: 80900, gbp: 16900, eur: 19900 },
  'GIT102': { inr: 2640000, usd: 23900, aed: 97900, gbp: 20900, eur: 24900 },
  'AIBIZ101': { inr: 2160000, usd: 18900, aed: 80900, gbp: 16900, eur: 19900 },
  'AIBIZ102': { inr: 2160000, usd: 18900, aed: 80900, gbp: 16900, eur: 19900 },
  'AIBIZ103': { inr: 2160000, usd: 18900, aed: 80900, gbp: 16900, eur: 19900 },
  'AI-300': { inr: 5376000, usd: 46900, aed: 199900, gbp: 41900, eur: 49900 },
  'GENAI115': { inr: 4000000, usd: 34900, aed: 148900, gbp: 30900, eur: 36900 },
  'GENAI116': { inr: 3500000, usd: 30900, aed: 129900, gbp: 27900, eur: 31900 },
  'GENAI117': { inr: 3000000, usd: 26900, aed: 111900, gbp: 23900, eur: 27900 },
  'OIC101': { inr: 4800000, usd: 41900, aed: 177900, gbp: 37900, eur: 43900 },
  // Fallback for unrecognised courseIds
  default: { inr: 1120000, usd: 9900, aed: 41900, gbp: 8900, eur: 10900 },
};

function getBasePriceMinor(courseId, currency) {
  const id = String(courseId);
  const curr = String(currency).toLowerCase();
  const val = priceCatalog[id]?.[curr] ?? priceCatalog.default?.[curr] ?? null;
  return typeof val === 'number' ? val : null;
}

function computeQuote({ courseId, enrollmentType, participants, currency, couponCode, baseMajor, referralDiscountRate }) {
  const normalizedCurrency = String(currency || 'usd').toLowerCase();
  if (!allowedCurrencies.includes(normalizedCurrency)) {
    throw new Error('Unsupported currency');
  }
  const numParticipants = Number.isFinite(Number(participants)) && Number(participants) > 0
    ? Math.min(50, Math.max(1, Number(participants)))
    : 1;

  // Always use server-side catalog — never trust client-supplied price
  let basePriceMinor = null;
  basePriceMinor = getBasePriceMinor(courseId, normalizedCurrency);
  if (!Number.isFinite(basePriceMinor) || basePriceMinor <= 0) {
    throw new Error('Price not configured for course/currency');
  }

  const getDiscountRate = (type, p) => {
    if (type === 'group') {
      if (p >= 10) return 0.35; // 35% for 10+
      if (p >= 5) return 0.25; // 25% for 5–9
      if (p >= 2) return 0.15; // 15% for 2–4
      return 0.15; // fallback if p < 2
    }
    return 0; // individual pays catalog price
  };

  let unitAmountMinor = 0;
  let quantity = numParticipants;
  let originalUnitMinor = basePriceMinor;

  const appliedDiscountRate = getDiscountRate(enrollmentType, numParticipants);
  unitAmountMinor = Math.max(1, Math.round(originalUnitMinor * (1 - appliedDiscountRate)));

  let couponApplied = false;
  let appliedCouponCode = null;
  let couponDiscountRate = 0;

  if (couponCode && typeof couponCode === 'string') {
    const code = couponCode.trim().toUpperCase();
    const coupon = validCoupons[code];
    if (coupon) {
      const allowed = coupon.currencies;
      if (!allowed || allowed.includes(normalizedCurrency)) {
        unitAmountMinor = Math.max(1, Math.round(unitAmountMinor * (1 - coupon.rate)));
        couponApplied = true;
        appliedCouponCode = code;
        couponDiscountRate = coupon.rate;
      }
    } else if (code) {
      console.warn(`Invalid coupon code attempted: ${code}`);
    }
  }

  // Apply referral discount on top of enrollment type + coupon discounts
  const appliedReferralRate = (Number.isFinite(Number(referralDiscountRate)) && Number(referralDiscountRate) > 0)
    ? Math.min(0.5, Number(referralDiscountRate)) // cap at 50%
    : 0;
  if (appliedReferralRate > 0) {
    unitAmountMinor = Math.max(1, Math.round(unitAmountMinor * (1 - appliedReferralRate)));
  }

  const expectedTotalMinor = unitAmountMinor * quantity;

  return {
    courseId: String(courseId),
    currency: normalizedCurrency,
    enrollmentType,
    participants: numParticipants,
    unitAmountMinor,
    quantity,
    expectedTotalMinor,
    originalUnitMinor,
    discountPercent: Math.round(appliedDiscountRate * 100),
    couponApplied,
    couponCode: appliedCouponCode,
    couponDiscountPercent: Math.round(couponDiscountRate * 100),
    referralDiscountPercent: Math.round(appliedReferralRate * 100),
    totalDiscountPercent: Math.round((1 - unitAmountMinor / originalUnitMinor) * 100),
  };
}


// Initialize Passport, but DO NOT use passport.session() for a stateless JWT approach
app.use(passport.initialize());

// Connect to the database
connectDb();


app.get('/api/ping', (req, res) => {
  // Get the current timestamp
  const timestamp = new Date().toISOString();

  console.log(`Ping received at: ${timestamp}`);

  // Respond with a JSON object confirming the server is awake.
  // This provides a clear, machine-readable confirmation.
  res.status(200).json({
    status: 'awake',
    message: 'Server is active and running.',
    timestamp: timestamp
  });
});

const couponLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// Use the new database-backed coupon validation from controller
app.post('/api/coupons/validate', couponLimiter, validateCoupon);

// Public: return the best active coupon for a given currency (falls back to global)
// GET /api/coupons/public?currency=inr
app.get('/api/coupons/public', async (req, res) => {
  try {
    const currency = req.query.currency?.toLowerCase() || null;
    const now = new Date();

    const baseFilter = {
      isActive: true,
      $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
    };

    // Try regional coupon first (matches the user's currency), then fall back to global
    const pick = async (currencyFilter) => {
      const candidates = await Coupon.find({ ...baseFilter, ...currencyFilter })
        .sort({ discountPercent: -1 }).limit(10).lean();
      return candidates.find(c => c.maxUsageCount == null || c.currentUsageCount < c.maxUsageCount) || null;
    };

    let coupon = null;
    if (currency) {
      coupon = await pick({ validCurrencies: currency });
    }
    if (!coupon) {
      coupon = await pick({ $or: [{ validCurrencies: null }, { validCurrencies: { $size: 0 } }] });
    }

    if (!coupon) return res.json({ coupon: null });
    return res.json({
      coupon: {
        code: coupon.code,
        discountPercent: coupon.discountPercent,
        description: coupon.description || "",
        expiryDate: coupon.expiryDate,
        isActive: coupon.isActive,
        currentUsageCount: coupon.currentUsageCount,
        maxUsageCount: coupon.maxUsageCount,
        createdAt: coupon.createdAt,
      },
    });
  } catch (err) {
    console.error("Public coupon fetch error:", err);
    return res.status(500).json({ coupon: null });
  }
});

app.post('/pricing/quote', async (req, res) => {
  try {
    const { courseId, enrollmentType, participants, couponCode, currency, baseMajor, referralCode } = req.body || {};
    if (!courseId || !enrollmentType) {
      return res.status(400).json({ error: 'Missing required fields: courseId, enrollmentType' });
    }

    let referralDiscountRate = 0;
    if (referralCode && typeof referralCode === 'string') {
      const trimmed = referralCode.trim().toUpperCase();
      const referrer = await User.findOne({ referralCode: trimmed }).lean();
      if (referrer) {
        referralDiscountRate = (referrer.referralDiscountPct || 10) / 100;
      }
    }

    const quote = computeQuote({ courseId, enrollmentType, participants, currency, couponCode, baseMajor, referralDiscountRate });
    return res.json(quote);
  } catch (err) {
    console.error('Quote error:', err.message);
    return res.status(400).json({ error: err.message || 'Failed to compute quote' });
  }
});

app.post('/stripe/checkout', async (req, res) => {
  try {
    const { courseId, enrollmentType, participants, couponCode, currency, baseMajor, clientCalculatedTotal, clientCalculatedCouponDiscount, learner, courseInfo, referralCode, utm } = req.body || {};

    if (!courseId || !enrollmentType) {
      return res.status(400).json({ error: 'Missing required fields: courseId, enrollmentType' });
    }

    let referralDiscountRate = 0;
    if (referralCode && typeof referralCode === 'string') {
      const trimmed = referralCode.trim().toUpperCase();
      const referrer = await User.findOne({ referralCode: trimmed }).lean();
      if (referrer) {
        referralDiscountRate = (referrer.referralDiscountPct || 10) / 100;
      } else {
        console.warn(`Invalid referral code at checkout: ${trimmed}`);
      }
    }

    const quote = computeQuote({ courseId, enrollmentType, participants, currency, couponCode, baseMajor, referralDiscountRate });

    // Validate client calculation vs backend calculation
    const backendTotalMinor = quote.expectedTotalMinor;
    const clientTotalMinor = clientCalculatedTotal ? Math.round(Number(clientCalculatedTotal) * 100) : backendTotalMinor;
    const priceMismatchPercent = backendTotalMinor > 0
      ? Math.abs((clientTotalMinor - backendTotalMinor) / backendTotalMinor) * 100
      : 0;

    if (priceMismatchPercent > 1) {
      // Log significant price mismatches (> 1%) for monitoring
      console.warn(`⚠️ Price mismatch for order ${generateOrderId()}:`, {
        courseId,
        enrollmentType,
        participants,
        couponCode: couponCode || 'none',
        currency,
        clientCalculatedTotal,
        clientCalculatedCouponDiscount,
        backendTotalMinor,
        clientTotalMinor,
        mismatchPercent: priceMismatchPercent.toFixed(2) + '%',
        couponApplied: quote.couponApplied,
        appliedCoupon: quote.couponCode || 'none',
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || (process.env.WHITELISTED_URLS ? process.env.WHITELISTED_URLS.split(',')[0] : '');
    if (!frontendUrl) {
      return res.status(500).json({ error: 'Server misconfiguration: FRONTEND_URL/WHITELISTED_URLS not set' });
    }

    // Create order intent
    const orderId = generateOrderId();
    const expectedTotalMinor = quote.expectedTotalMinor;
    await PendingOrder.create({
      orderId,
      provider: 'stripe',
      courseId: String(quote.courseId),
      enrollmentType: quote.enrollmentType,
      participants: quote.participants,
      currency: quote.currency,
      basePriceMinor: quote.originalUnitMinor,
      unitAmountMinor: quote.unitAmountMinor,
      quantity: quote.quantity,
      expectedTotalMinor,
      enrollmentDiscountPercent: quote.discountPercent,
      couponApplied: quote.couponApplied,
      couponCode: quote.couponCode || null,
      couponDiscountPercent: quote.couponDiscountPercent,
      referralCode: referralCode ? referralCode.trim().toUpperCase() : null,
      referralDiscountPercent: quote.referralDiscountPercent,
      totalDiscountPercent: quote.totalDiscountPercent,
      learner: {
        fullName: learner?.fullName || '',
        email: learner?.email || '',
        phone: learner?.phone || '',
        city: learner?.city || '',
        trainingLocation: learner?.trainingLocation || '',
      },
      courseInfo: {
        title: courseInfo?.title || String(courseId),
        duration: courseInfo?.duration || '',
        time: courseInfo?.time || '',
      },
      utm: utm && typeof utm === 'object' ? utm : undefined,
    });

    // Save lead to DB before redirecting — captures abandoned checkouts too
    try {
      await User.create({
        name: learner?.fullName || '',
        email: learner?.email || '',
        phone: learner?.phone || '',
        courseTitle: courseInfo?.title || String(courseId),
        trainingLocation: learner?.trainingLocation || '',
        trainingType: enrollmentType || 'individual',
        price: Number.isFinite(Number(quote.expectedTotalMinor)) ? (quote.expectedTotalMinor / 100).toFixed(2) : '',
        currency: quote.currency?.toUpperCase(),
        orderId,
        status: 'pending-payment',
        utm: utm && typeof utm === 'object' ? utm : undefined,
      });
    } catch (dbErr) {
      console.error('Failed to save pre-payment lead:', dbErr);
      // Non-blocking — still proceed to Stripe
    }

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: quote.currency,
            product_data: {
              name: `Course ${courseId} - ${enrollmentType}`,
            },
            unit_amount: quote.unitAmountMinor,
          },
          quantity: quote.quantity,
        },
      ],
      mode: 'payment',
      success_url: `${frontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/cancel`,
      metadata: {
        courseId: String(quote.courseId),
        enrollmentType: quote.enrollmentType,
        participants: String(quote.participants),
        currency: quote.currency,
        orderId,
        // minimal learner metadata to aid ops (full details in memory store)
        learnerEmail: learner?.email || '',
        learnerName: learner?.fullName || '',
      },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Razorpay - Create order
app.post('/razorpay/checkout', async (req, res) => {
  try {
    const { courseId, enrollmentType, participants, couponCode, currency, baseMajor, clientCalculatedTotal, clientCalculatedCouponDiscount, learner, courseInfo, referralCode, utm } = req.body || {};

    if (!courseId || !enrollmentType) {
      return res.status(400).json({ error: 'Missing required fields: courseId, enrollmentType' });
    }

    let referralDiscountRate = 0;
    if (referralCode && typeof referralCode === 'string') {
      const trimmed = referralCode.trim().toUpperCase();
      const referrer = await User.findOne({ referralCode: trimmed }).lean();
      if (referrer) {
        referralDiscountRate = (referrer.referralDiscountPct || 10) / 100;
      } else {
        console.warn(`Invalid referral code at Razorpay checkout: ${trimmed}`);
      }
    }

    const quote = computeQuote({ courseId, enrollmentType, participants, currency, couponCode, baseMajor, referralDiscountRate });

    const backendTotalMinor = quote.expectedTotalMinor;
    const clientTotalMinor = clientCalculatedTotal ? Math.round(Number(clientCalculatedTotal) * 100) : backendTotalMinor;
    const priceMismatchPercent = backendTotalMinor > 0
      ? Math.abs((clientTotalMinor - backendTotalMinor) / backendTotalMinor) * 100
      : 0;

    if (priceMismatchPercent > 1) {
      console.warn(`⚠️ Price mismatch for Razorpay order:`, {
        courseId, enrollmentType, participants, couponCode: couponCode || 'none', currency,
        clientCalculatedTotal, clientCalculatedCouponDiscount, backendTotalMinor, clientTotalMinor,
        mismatchPercent: priceMismatchPercent.toFixed(2) + '%',
        couponApplied: quote.couponApplied, appliedCoupon: quote.couponCode || 'none',
      });
    }

    const orderId = generateOrderId();

    const razorpayOrder = await razorpay.orders.create({
      amount: quote.expectedTotalMinor,
      currency: quote.currency.toUpperCase(),
      receipt: orderId,
      notes: {
        courseId: String(courseId),
        enrollmentType,
        learnerEmail: learner?.email || '',
        learnerName: learner?.fullName || '',
      },
    });

    await PendingOrder.create({
      orderId,
      provider: 'razorpay',
      razorpayOrderId: razorpayOrder.id,
      courseId: String(quote.courseId),
      enrollmentType: quote.enrollmentType,
      participants: quote.participants,
      currency: quote.currency,
      basePriceMinor: quote.originalUnitMinor,
      unitAmountMinor: quote.unitAmountMinor,
      quantity: quote.quantity,
      expectedTotalMinor: quote.expectedTotalMinor,
      enrollmentDiscountPercent: quote.discountPercent,
      couponApplied: quote.couponApplied,
      couponCode: quote.couponCode || null,
      couponDiscountPercent: quote.couponDiscountPercent,
      referralCode: referralCode ? referralCode.trim().toUpperCase() : null,
      referralDiscountPercent: quote.referralDiscountPercent,
      totalDiscountPercent: quote.totalDiscountPercent,
      learner: {
        fullName: learner?.fullName || '',
        email: learner?.email || '',
        phone: learner?.phone || '',
        city: learner?.city || '',
        trainingLocation: learner?.trainingLocation || '',
      },
      courseInfo: {
        title: courseInfo?.title || String(courseId),
        duration: courseInfo?.duration || '',
        time: courseInfo?.time || '',
      },
      utm: utm && typeof utm === 'object' ? utm : undefined,
    });

    try {
      await User.create({
        name: learner?.fullName || '',
        email: learner?.email || '',
        phone: learner?.phone || '',
        courseTitle: courseInfo?.title || String(courseId),
        trainingLocation: learner?.trainingLocation || '',
        trainingType: enrollmentType || 'individual',
        price: Number.isFinite(Number(quote.expectedTotalMinor)) ? (quote.expectedTotalMinor / 100).toFixed(2) : '',
        currency: quote.currency?.toUpperCase(),
        orderId,
        status: 'pending-payment',
        utm: utm && typeof utm === 'object' ? utm : undefined,
      });
    } catch (dbErr) {
      console.error('Failed to save pre-payment lead:', dbErr);
    }

    return res.json({
      orderId,
      razorpayOrderId: razorpayOrder.id,
      amount: quote.expectedTotalMinor,
      currency: quote.currency.toUpperCase(),
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('Razorpay checkout error:', err);
    return res.status(500).json({ error: 'Failed to create Razorpay order' });
  }
});

// ---- CART CHECKOUT ENDPOINTS ----

// Stripe: multi-course cart checkout
app.post('/stripe/cart-checkout', async (req, res) => {
  try {
    const { items, enrollmentType, participants, couponCode, referralCode, currency, learner, utm } = req.body || {};
    if (!items?.length || !enrollmentType) {
      return res.status(400).json({ error: 'Missing items or enrollmentType' });
    }

    let referralDiscountRate = 0;
    if (referralCode && typeof referralCode === 'string') {
      const trimmed = referralCode.trim().toUpperCase();
      const referrer = await User.findOne({ referralCode: trimmed }).lean();
      if (referrer) referralDiscountRate = (referrer.referralDiscountPct || 10) / 100;
    }

    const frontendUrl = process.env.FRONTEND_URL || (process.env.WHITELISTED_URLS ? process.env.WHITELISTED_URLS.split(',')[0] : '');
    const lineItems = [];
    const orderIds = [];

    for (const item of items) {
      const quote = computeQuote({ courseId: item.courseId, enrollmentType, participants, currency, couponCode, referralDiscountRate });
      const orderId = generateOrderId();
      orderIds.push(orderId);
      lineItems.push({
        price_data: {
          currency: quote.currency,
          product_data: { name: item.courseTitle || item.courseId },
          unit_amount: quote.unitAmountMinor,
        },
        quantity: quote.quantity,
      });
      await PendingOrder.create({
        orderId, provider: 'stripe',
        courseId: String(item.courseId),
        enrollmentType: quote.enrollmentType, participants: quote.participants,
        currency: quote.currency,
        basePriceMinor: quote.originalUnitMinor, unitAmountMinor: quote.unitAmountMinor,
        quantity: quote.quantity, expectedTotalMinor: quote.expectedTotalMinor,
        enrollmentDiscountPercent: quote.discountPercent,
        couponApplied: quote.couponApplied, couponCode: quote.couponCode || null,
        couponDiscountPercent: quote.couponDiscountPercent,
        referralCode: referralCode ? referralCode.trim().toUpperCase() : null,
        referralDiscountPercent: quote.referralDiscountPercent,
        totalDiscountPercent: quote.totalDiscountPercent,
        learner: { fullName: learner?.fullName || '', email: learner?.email || '', phone: learner?.phone || '', city: learner?.city || '', trainingLocation: learner?.trainingLocation || '' },
        courseInfo: { title: item.courseTitle || String(item.courseId), duration: item.courseInfo?.duration || '', time: item.courseInfo?.time || '' },
        utm: utm && typeof utm === 'object' ? utm : undefined,
      });
    }

    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: 'payment',
      success_url: `${frontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/cart`,
      metadata: { orderIds: JSON.stringify(orderIds), learnerEmail: learner?.email || '', learnerName: learner?.fullName || '' },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe cart-checkout error:', err);
    return res.status(500).json({ error: 'Failed to create cart checkout session' });
  }
});

// Razorpay: multi-course cart checkout (single Razorpay order for combined total)
app.post('/razorpay/cart-checkout', async (req, res) => {
  try {
    const { items, enrollmentType, participants, couponCode, referralCode, currency, learner, utm } = req.body || {};
    if (!items?.length || !enrollmentType) {
      return res.status(400).json({ error: 'Missing items or enrollmentType' });
    }

    let referralDiscountRate = 0;
    if (referralCode && typeof referralCode === 'string') {
      const trimmed = referralCode.trim().toUpperCase();
      const referrer = await User.findOne({ referralCode: trimmed }).lean();
      if (referrer) referralDiscountRate = (referrer.referralDiscountPct || 10) / 100;
    }

    const orderIds = [];
    let combinedTotalMinor = 0;
    let combinedCurrency = (currency || 'INR').toLowerCase();

    for (const item of items) {
      const quote = computeQuote({ courseId: item.courseId, enrollmentType, participants, currency, couponCode, referralDiscountRate });
      const orderId = generateOrderId();
      orderIds.push(orderId);
      combinedTotalMinor += quote.expectedTotalMinor;
      combinedCurrency = quote.currency;
      await PendingOrder.create({
        orderId, provider: 'razorpay',
        courseId: String(item.courseId),
        enrollmentType: quote.enrollmentType, participants: quote.participants,
        currency: quote.currency,
        basePriceMinor: quote.originalUnitMinor, unitAmountMinor: quote.unitAmountMinor,
        quantity: quote.quantity, expectedTotalMinor: quote.expectedTotalMinor,
        enrollmentDiscountPercent: quote.discountPercent,
        couponApplied: quote.couponApplied, couponCode: quote.couponCode || null,
        couponDiscountPercent: quote.couponDiscountPercent,
        referralCode: referralCode ? referralCode.trim().toUpperCase() : null,
        referralDiscountPercent: quote.referralDiscountPercent,
        totalDiscountPercent: quote.totalDiscountPercent,
        learner: { fullName: learner?.fullName || '', email: learner?.email || '', phone: learner?.phone || '', city: learner?.city || '', trainingLocation: learner?.trainingLocation || '' },
        courseInfo: { title: item.courseTitle || String(item.courseId), duration: item.courseInfo?.duration || '', time: item.courseInfo?.time || '' },
        utm: utm && typeof utm === 'object' ? utm : undefined,
      });
    }

    // Update primary (first) order to store all orderIds for verify
    const primaryOrderId = orderIds[0];
    await PendingOrder.updateOne({ orderId: primaryOrderId }, { $set: { cartOrderIds: orderIds } });

    const razorpayOrder = await razorpay.orders.create({
      amount: combinedTotalMinor,
      currency: combinedCurrency.toUpperCase(),
      receipt: primaryOrderId,
      notes: { orderIds: orderIds.join(','), learnerEmail: learner?.email || '', learnerName: learner?.fullName || '' },
    });

    // Store razorpayOrderId on primary pending order
    await PendingOrder.updateOne({ orderId: primaryOrderId }, { $set: { razorpayOrderId: razorpayOrder.id } });

    return res.json({ orderIds, primaryOrderId, razorpayOrderId: razorpayOrder.id, amount: combinedTotalMinor, currency: combinedCurrency.toUpperCase(), keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('Razorpay cart-checkout error:', err);
    return res.status(500).json({ error: 'Failed to create Razorpay cart order' });
  }
});

// Razorpay: verify cart payment — marks all cart orders paid
app.post('/razorpay/cart-verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderIds, primaryOrderId } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderIds?.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const paidAt = Date.now();
    let firstOrderId = primaryOrderId || orderIds[0];
    for (const orderId of orderIds) {
      const order = await PendingOrder.findOne({ orderId }).lean();
      if (!order || order.status === 'paid') continue;
      await PendingOrder.updateOne({ orderId }, { $set: { status: 'paid', paidAt, razorpayPaymentId: razorpay_payment_id } });
      const invoiceNumber = `INV-${new Date().toISOString().slice(0, 7).replace('-', '')}-${orderId.slice(-6).toUpperCase()}`;
      try {
        await Order.create({ ...order, _id: undefined, invoiceNumber, status: 'paid', paidAt, razorpayPaymentId: razorpay_payment_id });
      } catch { /* duplicate, skip */ }
      if (order.couponCode) await incrementCouponUsage(order.couponCode).catch(() => {});
      const enrollmentToken = Buffer.from(`${orderId}|${order.learner.email}|${paidAt}`).toString('base64');
      const amountMajorStr = (order.expectedTotalMinor / 100).toFixed(2);
      try {
        const updated = await User.findOneAndUpdate({ orderId }, { status: 'enrolled', price: amountMajorStr, enrollmentToken, enrolledAt: new Date() }, { new: true });
        if (!updated) {
          await User.create({ name: order.learner.fullName, email: order.learner.email, phone: order.learner.phone, courseTitle: order.courseInfo.title, trainingLocation: order.learner.trainingLocation, trainingType: order.enrollmentType, price: amountMajorStr, currency: order.currency?.toUpperCase(), orderId, status: 'enrolled', enrollmentToken, enrolledAt: new Date() });
        }
      } catch { /* non-blocking */ }
      if (order.learner?.email) {
        try {
          await sendEmail({ from: fromAddresses.sales, to: order.learner.email, subject: `Payment Received - ${order.courseInfo?.title || 'Technohana Course'}`, html: generatePaymentSuccessEmail({ name: order.learner.fullName, courseTitle: order.courseInfo?.title, amountMajor: amountMajorStr, currency: order.currency, enrollmentType: order.enrollmentType, participants: order.participants, trainingLocation: order.learner.trainingLocation }) });
        } catch { /* non-blocking */ }
      }
    }

    return res.json({ success: true, primaryOrderId: firstOrderId });
  } catch (err) {
    console.error('Razorpay cart-verify error:', err);
    return res.status(500).json({ error: 'Cart payment verification failed' });
  }
});

// ---- END CART CHECKOUT ENDPOINTS ----

// Razorpay - Verify payment signature and mark paid
app.post('/razorpay/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId) {
      return res.status(400).json({ error: 'Missing required payment verification fields' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const order = await PendingOrder.findOne({ orderId }).lean();
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    let invoiceNumber = '';
    if (order.status !== 'paid') {
      const paidAt = Date.now();
      await PendingOrder.updateOne({ orderId }, { $set: { status: 'paid', paidAt, razorpayPaymentId: razorpay_payment_id } });

      // Archive to permanent Order collection
      invoiceNumber = `INV-${new Date().toISOString().slice(0, 7).replace('-', '')}-${orderId.slice(-6).toUpperCase()}`;
      try {
        await Order.create({ ...order, _id: undefined, invoiceNumber, status: 'paid', paidAt, razorpayPaymentId: razorpay_payment_id });
      } catch (archiveErr) {
        console.error('Failed to archive Order:', archiveErr);
      }

      // Increment coupon usage if a coupon was applied
      if (order.couponCode) {
        await incrementCouponUsage(order.couponCode).catch(err =>
          console.error('Failed to increment coupon usage:', err)
        );
      }

      const enrollmentToken = Buffer.from(`${orderId}|${order.learner.email}|${Date.now()}`).toString('base64');
      const amountMajorStr = Number.isFinite(Number(order.expectedTotalMinor))
        ? (Number(order.expectedTotalMinor) / 100).toFixed(2)
        : '';

      try {
        const updated = await User.findOneAndUpdate(
          { orderId },
          { status: 'enrolled', price: amountMajorStr, enrollmentToken, enrolledAt: new Date() },
          { new: true }
        );
        if (!updated) {
          await User.create({
            name: order.learner.fullName,
            email: order.learner.email,
            phone: order.learner.phone,
            courseTitle: order.courseInfo.title,
            trainingLocation: order.learner.trainingLocation,
            trainingType: order.enrollmentType,
            price: amountMajorStr,
            currency: order.currency?.toUpperCase(),
            orderId,
            status: 'enrolled',
            enrollmentToken,
            enrolledAt: new Date(),
          });
        }
      } catch (dbErr) {
        console.error('Failed to update enrollment in DB:', dbErr);
      }

      try {
        if (order.learner?.email) {
          await sendEmail({
            from: fromAddresses.sales,
            to: order.learner.email,
            subject: `Payment Received - ${order.courseInfo?.title || 'Technohana Course'}`,
            html: generatePaymentSuccessEmail({
              name: order.learner.fullName,
              courseTitle: order.courseInfo?.title,
              amountMajor: amountMajorStr,
              currency: order.currency,
              enrollmentType: order.enrollmentType,
              participants: order.participants,
              trainingLocation: order.learner.trainingLocation,
            }),
          });
        }
        await sendEmail({
          from: fromAddresses.sales,
          to: process.env.MAIL_TO,
          subject: `New Paid Enrollment - ${order.courseInfo?.title || order.courseId}`,
          html: generateEnrollmentDetailsForSales({
            orderId,
            learner: order.learner,
            courseInfo: order.courseInfo,
            amountMinor: order.expectedTotalMinor,
            currency: order.currency,
            enrollmentType: order.enrollmentType,
            participants: order.participants,
          }),
        });
      } catch (mailErr) {
        console.error('Email send failed after Razorpay payment:', mailErr);
      }

      // Emit campaign event for automation (welcome emails, etc.)
      try {
        emitCampaignEvent('PAYMENT_RECEIVED', {
          email: order.learner.email,
          name: order.learner.fullName,
          courseTitle: order.courseInfo?.title,
          amount: amountMajorStr,
          currency: order.currency,
        });
        // Also emit enrollment complete event
        emitCampaignEvent('ENROLLMENT_COMPLETE', {
          email: order.learner.email,
          name: order.learner.fullName,
          courseTitle: order.courseInfo?.title,
          enrolledAt: new Date(),
        });
      } catch (eventErr) {
        console.error('Failed to emit payment event:', eventErr);
        // Non-blocking — payment is confirmed regardless of event emission
      }
    }

    return res.json({ success: true, orderId, invoiceNumber });
  } catch (err) {
    console.error('Razorpay verify error:', err);
    return res.status(500).json({ error: 'Payment verification failed' });
  }
});

// Payment-confirm endpoint: verify session and send emails
app.post('/payments/confirm', async (req, res) => {
  try {
    const { session_id: sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing session_id' });
    }

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const amountTotal = session?.amount_total;
    const currency = session?.currency;
    const paymentStatus = session?.payment_status;

    if (paymentStatus !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Cart checkout: session has orderIds array in metadata
    const rawOrderIds = session?.metadata?.orderIds;
    if (rawOrderIds) {
      let parsedIds = [];
      try { parsedIds = JSON.parse(rawOrderIds); } catch { /* ignore */ }
      const paidAt = Date.now();
      let firstInvoiceNumber = '';
      for (const oid of parsedIds) {
        const o = await PendingOrder.findOne({ orderId: oid }).lean();
        if (!o || o.status === 'paid') continue;
        await PendingOrder.updateOne({ orderId: oid }, { $set: { status: 'paid', paidAt } });
        const inv = `INV-${new Date().toISOString().slice(0, 7).replace('-', '')}-${oid.slice(-6).toUpperCase()}`;
        if (!firstInvoiceNumber) firstInvoiceNumber = inv;
        try { await Order.create({ ...o, _id: undefined, invoiceNumber: inv, status: 'paid', paidAt }); } catch { /* dup */ }
        if (o.couponCode) await incrementCouponUsage(o.couponCode).catch(() => {});
        const enrollmentToken = Buffer.from(`${oid}|${o.learner.email}|${paidAt}`).toString('base64');
        const amtStr = (o.expectedTotalMinor / 100).toFixed(2);
        try {
          const updated = await User.findOneAndUpdate({ orderId: oid }, { status: 'enrolled', price: amtStr, enrollmentToken, enrolledAt: new Date() }, { new: true });
          if (!updated) await User.create({ name: o.learner.fullName, email: o.learner.email, phone: o.learner.phone, courseTitle: o.courseInfo.title, trainingLocation: o.learner.trainingLocation, trainingType: o.enrollmentType, price: amtStr, currency: o.currency?.toUpperCase(), orderId: oid, status: 'enrolled', enrollmentToken, enrolledAt: new Date() });
        } catch { /* non-blocking */ }
        if (o.learner?.email) {
          try { await sendEmail({ from: fromAddresses.sales, to: o.learner.email, subject: `Payment Received - ${o.courseInfo?.title || 'Technohana Course'}`, html: generatePaymentSuccessEmail({ name: o.learner.fullName, courseTitle: o.courseInfo?.title, amountMajor: amtStr, currency: o.currency, enrollmentType: o.enrollmentType, participants: o.participants, trainingLocation: o.learner.trainingLocation }) }); } catch { /* non-blocking */ }
        }
      }
      return res.json({ success: true, orderId: parsedIds[0], invoiceNumber: firstInvoiceNumber });
    }

    // Single order checkout
    const orderId = session?.metadata?.orderId;
    const order = orderId ? await PendingOrder.findOne({ orderId }).lean() : null;
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.expectedTotalMinor !== amountTotal || order.currency !== currency) {
      return res.status(400).json({ error: 'Amount or currency mismatch' });
    }

    // Mark order paid if not already
    let invoiceNumber = '';
    if (order.status !== 'paid') {
      const paidAt = Date.now();
      await PendingOrder.updateOne({ orderId }, { $set: { status: 'paid', paidAt } });

      // Archive to permanent Order collection
      invoiceNumber = `INV-${new Date().toISOString().slice(0, 7).replace('-', '')}-${orderId.slice(-6).toUpperCase()}`;
      try {
        await Order.create({ ...order, _id: undefined, invoiceNumber, status: 'paid', paidAt });
      } catch (archiveErr) {
        console.error('Failed to archive Order:', archiveErr);
      }

      // Increment coupon usage if a coupon was applied
      if (order.couponCode) {
        await incrementCouponUsage(order.couponCode).catch(err =>
          console.error('Failed to increment coupon usage:', err)
        );
      }

      // Generate enrollment token
      const enrollmentToken = Buffer.from(`${orderId}|${order.learner.email}|${Date.now()}`).toString('base64');

      // Upgrade the pre-payment lead to enrolled; fallback to create if missing
      try {
        const amountMajorStr = Number.isFinite(Number(amountTotal))
          ? (Number(amountTotal) / 100).toFixed(2)
          : '';
        const updated = await User.findOneAndUpdate(
          { orderId },
          {
            status: 'enrolled',
            price: amountMajorStr,
            enrollmentToken,
            enrolledAt: new Date()
          },
          { new: true }
        );
        if (!updated) {
          // Pre-payment save may have failed — create fresh record
          await User.create({
            name: order.learner.fullName,
            email: order.learner.email,
            phone: order.learner.phone,
            courseTitle: order.courseInfo.title,
            trainingLocation: order.learner.trainingLocation,
            trainingType: order.enrollmentType,
            price: amountMajorStr,
            currency: order.currency?.toUpperCase(),
            orderId,
            status: 'enrolled',
            enrollmentToken,
            enrolledAt: new Date()
          });
        }
      } catch (dbErr) {
        console.error('Failed to update enrollment lead in DB:', dbErr);
        // Non-blocking — payment is confirmed, we still send emails
      }
    }

    // Send emails
    try {
      const amountMajor = Number.isFinite(Number(amountTotal)) ? (Number(amountTotal) / 100).toFixed(2) : '';
      if (order.learner?.email) {
        await sendEmail({
          from: fromAddresses.sales,
          to: order.learner.email,
          subject: `Payment Received - ${order.courseInfo?.title || 'Technohana Course'}`,
          html: generatePaymentSuccessEmail({
            name: order.learner.fullName,
            courseTitle: order.courseInfo?.title,
            amountMajor,
            currency,
            enrollmentType: order.enrollmentType,
            participants: order.participants,
            trainingLocation: order.learner.trainingLocation,
          }),
        });
      }

      await sendEmail({
        from: fromAddresses.sales,
        to: process.env.MAIL_TO,
        subject: `New Paid Enrollment - ${order.courseInfo?.title || order.courseId}`,
        html: generateEnrollmentDetailsForSales({
          orderId,
          learner: order.learner,
          courseInfo: order.courseInfo,
          amountMinor: amountTotal,
          currency,
          enrollmentType: order.enrollmentType,
          participants: order.participants,
        }),
      });
    } catch (mailErr) {
      console.error('Email send failed:', mailErr);
      return res.status(500).json({ error: 'Failed to send emails' });
    }

    // Emit campaign event for automation (welcome emails, etc.)
    try {
      emitCampaignEvent('PAYMENT_RECEIVED', {
        email: order.learner.email,
        name: order.learner.fullName,
        courseTitle: order.courseInfo?.title,
        amount: amountMajor,
        currency,
      });
      // Also emit enrollment complete event
      emitCampaignEvent('ENROLLMENT_COMPLETE', {
        email: order.learner.email,
        name: order.learner.fullName,
        courseTitle: order.courseInfo?.title,
        enrolledAt: new Date(),
      });
    } catch (eventErr) {
      console.error('Failed to emit payment event:', eventErr);
      // Non-blocking — payment is confirmed regardless of event emission
    }

    return res.json({ success: true, orderId, invoiceNumber });
  } catch (err) {
    console.error('payments/confirm error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get order details by orderId
app.get('/payments/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId' });
    }

    const order = (await Order.findOne({ orderId }).lean()) || (await PendingOrder.findOne({ orderId }).lean());
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    return res.json({
      orderId: order.orderId,
      invoiceNumber: order.invoiceNumber || '',
      courseId: order.courseId,
      courseInfo: order.courseInfo,
      learner: order.learner,
      enrollmentType: order.enrollmentType,
      participants: order.participants,
      currency: order.currency,
      basePriceMinor: order.basePriceMinor,
      unitAmountMinor: order.unitAmountMinor,
      quantity: order.quantity,
      expectedTotalMinor: order.expectedTotalMinor,
      enrollmentDiscountPercent: order.enrollmentDiscountPercent,
      couponCode: order.couponCode,
      couponDiscountPercent: order.couponDiscountPercent,
      referralDiscountPercent: order.referralDiscountPercent,
      totalDiscountPercent: order.totalDiscountPercent,
      status: order.status,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
    });
  } catch (err) {
    console.error('Get order error:', err);
    return res.status(500).json({ error: 'Failed to retrieve order' });
  }
});

// Get all paid orders for the authenticated learner
app.get('/payments/my-orders', authenticateJWT, async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });
    const orders = await Order.find({ 'learner.email': email }).sort({ paidAt: -1 }).lean();
    return res.json(orders.map(o => ({
      orderId: o.orderId,
      invoiceNumber: o.invoiceNumber,
      courseInfo: o.courseInfo,
      enrollmentType: o.enrollmentType,
      participants: o.participants,
      currency: o.currency,
      expectedTotalMinor: o.expectedTotalMinor,
      basePriceMinor: o.basePriceMinor,
      unitAmountMinor: o.unitAmountMinor,
      enrollmentDiscountPercent: o.enrollmentDiscountPercent,
      couponCode: o.couponCode,
      couponDiscountPercent: o.couponDiscountPercent,
      referralDiscountPercent: o.referralDiscountPercent,
      totalDiscountPercent: o.totalDiscountPercent,
      learner: o.learner,
      paidAt: o.paidAt,
      createdAt: o.createdAt,
    })));
  } catch (err) {
    console.error('my-orders error:', err);
    return res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Stripe Webhook - must use raw body for signature verification
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    const amountTotal = session.amount_total; // total in minor units
    const currency = session.currency;

    if (orderId) {
      const order = await PendingOrder.findOne({ orderId }).lean();
      if (order) {
        if (order.expectedTotalMinor === amountTotal && order.currency === currency) {
          await PendingOrder.updateOne({ orderId }, { $set: { status: 'paid', paidAt: Date.now() } });
          console.log('Order marked paid:', orderId);
        } else {
          console.warn('Order totals mismatch. Expected:', order.expectedTotalMinor, 'Got:', amountTotal);
          await PendingOrder.updateOne({ orderId }, { $set: { status: 'mismatch' } });
        }
      }
    }

    // Cart checkout: metadata has orderIds (plural) instead of orderId
    const rawOrderIds = session.metadata?.orderIds;
    if (!orderId && rawOrderIds) {
      let ids = [];
      try { ids = JSON.parse(rawOrderIds); } catch { /* ignore */ }
      const paidAt = Date.now();
      for (const oid of ids) {
        await PendingOrder.updateOne(
          { orderId: oid, status: { $ne: 'paid' } },
          { $set: { status: 'paid', paidAt } }
        );
      }
      console.log('Cart orders marked paid via webhook:', ids);
    }
  }

  res.json({ received: true });
});

// ─── UTM Attribution Report ───────────────────────────────────────────────────

app.get('/admin/utm-report', authenticateAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }

    const enquiryMatch = { ...(from || to ? { createdAt: dateFilter } : {}) };
    const enrollmentMatch = {
      status: { $in: ['enrolled', 'in-progress', 'completed', 'pending-payment'] },
      ...(from || to ? { createdAt: dateFilter } : {}),
    };

    const [enquiryRows, enrollmentRows] = await Promise.all([
      Enquiry.aggregate([
        { $match: { ...enquiryMatch, 'utm.utm_source': { $exists: true } } },
        {
          $group: {
            _id: {
              source: '$utm.utm_source',
              medium: '$utm.utm_medium',
              campaign: '$utm.utm_campaign',
            },
            enquiries: { $sum: 1 },
          },
        },
        { $sort: { enquiries: -1 } },
      ]),
      User.aggregate([
        { $match: enrollmentMatch },
        {
          $group: {
            _id: {
              source: { $ifNull: ['$utm.utm_source', '(direct)'] },
              medium: { $ifNull: ['$utm.utm_medium', '(none)'] },
              campaign: { $ifNull: ['$utm.utm_campaign', '(none)'] },
            },
            leads: { $sum: 1 },
            enrolled: {
              $sum: {
                $cond: [{ $in: ['$status', ['enrolled', 'in-progress', 'completed']] }, 1, 0],
              },
            },
          },
        },
        { $sort: { leads: -1 } },
      ]),
    ]);

    // Merge enquiry and enrollment rows by source/medium/campaign key
    const map = new Map();
    for (const row of enrollmentRows) {
      const key = `${row._id.source}|${row._id.medium}|${row._id.campaign}`;
      map.set(key, { source: row._id.source, medium: row._id.medium, campaign: row._id.campaign, enquiries: 0, leads: row.leads, enrolled: row.enrolled });
    }
    for (const row of enquiryRows) {
      const key = `${row._id.source}|${row._id.medium}|${row._id.campaign}`;
      if (map.has(key)) {
        map.get(key).enquiries = row.enquiries;
      } else {
        map.set(key, { source: row._id.source, medium: row._id.medium, campaign: row._id.campaign, enquiries: row.enquiries, leads: 0, enrolled: 0 });
      }
    }

    const rows = Array.from(map.values()).sort((a, b) => (b.enquiries + b.leads) - (a.enquiries + a.leads));
    res.json({ rows });
  } catch (err) {
    console.error('[UTM Report] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- ROUTES ---
// We can now safely use our routes
app.use('/', authRoutes);
app.use('/', enquiryRoutes);
app.use('/', enrollmentRoutes);
app.use('/', subscriptionRoutes);
app.use("/", blogRoutes);
app.use("/", chatRoutes);
app.use("/", courseRoutes);
app.use("/admin", adminRoutes);
app.use("/api", courseViewRoutes);
app.use("/admin", courseViewRoutes);
app.use("/api/referral", referralRoutes);
app.use("/api/abandoned-enrollment", abandonedEnrollmentRoutes);
app.use("/", testimonialRoutes);

// ─── Campaign Automation ───────────────────────────────────────────────────────

// POST /webhooks/resend - Webhook for Resend email events (opened, clicked, bounced, etc.)
app.post("/webhooks/resend", handleResendWebhook);

// Register campaign event listeners (enrollment, referral, payment, etc.)
registerCampaignEventListeners();

// ─── Automated Email Sequences ────────────────────────────────────────────────

// Abandoned cart: check every 30 minutes, send re-engagement email after 2h
const ABANDONED_CART_DELAY_MS = 2 * 60 * 60 * 1000;
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - ABANDONED_CART_DELAY_MS);
    const users = await User.find({
      enrollmentFormAbandonedAt: { $lte: cutoff },
      enrollmentReminderSent: false,
      enrollmentFormData: { $ne: null },
    }).limit(50);

    for (const user of users) {
      try {
        await sendEmail({
          from: fromAddresses.sales,
          to: user.email,
          subject: "You left something behind — complete your enrollment",
          html: generateAbandonedCartEmail({
            name: user.name,
            courseTitle: user.enrollmentFormData?.courseTitle,
          }),
        });
        user.enrollmentReminderSent = true;
        user.enrollmentReminderSentAt = new Date();
        await user.save();
      } catch (e) {
        console.error(`[AutoEmail] Abandoned cart send failed for ${user.email}:`, e.message);
      }
    }
    if (users.length > 0) console.log(`[AutoEmail] Sent ${users.length} abandoned cart emails`);
  } catch (e) {
    console.error('[AutoEmail] Abandoned cart check error:', e.message);
  }
}, 30 * 60 * 1000);

// Post-enrollment Day 3 + Day 7 sequences: check every hour
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
setInterval(async () => {
  try {
    const now = Date.now();
    const day3Cutoff = new Date(now - THREE_DAYS_MS);
    const day7Cutoff = new Date(now - SEVEN_DAYS_MS);

    // Day 3 emails
    const day3Users = await User.find({
      enrolledAt: { $lte: day3Cutoff },
      day3EmailSent: false,
    }).limit(50);

    for (const user of day3Users) {
      try {
        await sendEmail({
          from: fromAddresses.connect,
          to: user.email,
          subject: "3 days in — tips to get the most from your training",
          html: generateDay3Email({ name: user.name, courseTitle: user.enrollmentFormData?.courseTitle }),
        });
        user.day3EmailSent = true;
        await user.save();
      } catch (e) {
        console.error(`[AutoEmail] Day 3 send failed for ${user.email}:`, e.message);
      }
    }

    // Day 7 emails
    const day7Users = await User.find({
      enrolledAt: { $lte: day7Cutoff },
      day7EmailSent: false,
    }).limit(50);

    for (const user of day7Users) {
      try {
        await sendEmail({
          from: fromAddresses.connect,
          to: user.email,
          subject: "One week in — you're doing great",
          html: generateDay7Email({ name: user.name, courseTitle: user.enrollmentFormData?.courseTitle }),
        });
        user.day7EmailSent = true;
        await user.save();
      } catch (e) {
        console.error(`[AutoEmail] Day 7 send failed for ${user.email}:`, e.message);
      }
    }

    const total = day3Users.length + day7Users.length;
    if (total > 0) console.log(`[AutoEmail] Post-enrollment: ${day3Users.length} day-3, ${day7Users.length} day-7 emails sent`);
  } catch (e) {
    console.error('[AutoEmail] Post-enrollment check error:', e.message);
  }
}, 60 * 60 * 1000);

// ─── Server Startup ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});