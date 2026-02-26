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
import { generateEnrollmentDetailsForSales, generatePaymentSuccessEmail } from "./utils/emailTemplate.js";
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
  orderId:   { type: String, required: true, unique: true, index: true },
  provider:  { type: String, enum: ['stripe', 'razorpay'] },
  razorpayOrderId: { type: String },
  courseId:  { type: String },
  enrollmentType: { type: String },
  participants: { type: Number },
  currency:  { type: String },
  basePriceMinor: { type: Number },
  unitAmountMinor: { type: Number },
  quantity:  { type: Number },
  expectedTotalMinor: { type: Number },
  enrollmentDiscountPercent: { type: Number },
  couponApplied: { type: Boolean },
  couponCode: { type: String },
  couponDiscountPercent: { type: Number },
  referralCode: { type: String },
  referralDiscountPercent: { type: Number },
  totalDiscountPercent: { type: Number },
  status:    { type: String, default: 'pending' },
  paidAt:    { type: Number },
  razorpayPaymentId: { type: String },
  learner:   { type: Object },
  courseInfo: { type: Object },
  createdAt: { type: Date, default: Date.now, expires: 86400 },
});
const PendingOrder = mongoose.model('PendingOrder', PendingOrderSchema);

const generateOrderId = () => `ord_${Math.random().toString(36).slice(2, 10)}`;

// --- Pricing utilities (Replace with DB/config-backed logic) ---
const allowedCurrencies = ['usd', 'inr', 'aed', 'eur', 'gbp'];

// Coupon map — single source of truth for both validation and quote computation
// currencies: null means global (any currency); otherwise array of allowed currency codes
const validCoupons = {
  'DIWALI10':      { rate: 0.10, currencies: ['inr'] },
  'HOLI5':         { rate: 0.05, currencies: ['inr'] },
  'EID10':         { rate: 0.10, currencies: ['aed'] },
  'RAMADAN8':      { rate: 0.08, currencies: ['aed'] },
  'XMAS10':        { rate: 0.10, currencies: ['usd', 'gbp', 'eur'] },
  'THANKSGIVING7': { rate: 0.07, currencies: ['usd'] },
  'EASTER6':       { rate: 0.06, currencies: ['gbp', 'eur'] },
  'NEWYEAR5':      { rate: 0.05, currencies: null },
};

const priceCatalog = {
  // Per-course prices in MINOR units (major × 100) per currency
  // Generated via scripts/generate-prices.js using PPP multipliers
  'GENAI101':   { inr: 5600000,  usd: 48900,  aed: 207900, gbp: 43900, eur: 51900 },
  'GENAI102':   { inr: 2000000,  usd: 17900,  aed: 74900,  gbp: 15900, eur: 18900 },
  'GENAI103':   { inr: 900000,   usd: 7900,   aed: 33900,  gbp: 7900,  eur: 8900  },
  'GENAI104':   { inr: 7500000,  usd: 65900,  aed: 277900, gbp: 57900, eur: 68900 },
  'GENAI105':   { inr: 800000,   usd: 7900,   aed: 29900,  gbp: 6900,  eur: 7900  },
  'GENAI106':   { inr: 2500000,  usd: 21900,  aed: 92900,  gbp: 19900, eur: 22900 },
  'GENAI107':   { inr: 1500000,  usd: 13900,  aed: 55900,  gbp: 11900, eur: 13900 },
  'GENAI108':   { inr: 3350000,  usd: 29900,  aed: 124900, gbp: 25900, eur: 30900 },
  'GENAI109':   { inr: 5000000,  usd: 43900,  aed: 185900, gbp: 38900, eur: 45900 },
  'DSML101':    { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'DSML102':    { inr: 3360000,  usd: 29900,  aed: 124900, gbp: 25900, eur: 30900 },
  'DSML103':    { inr: 5600000,  usd: 48900,  aed: 207900, gbp: 43900, eur: 51900 },
  'DSML104':    { inr: 5600000,  usd: 48900,  aed: 207900, gbp: 43900, eur: 51900 },
  'DSML105':    { inr: 5600000,  usd: 48900,  aed: 207900, gbp: 43900, eur: 51900 },
  'DSML106':    { inr: 5600000,  usd: 48900,  aed: 207900, gbp: 43900, eur: 51900 },
  'DSML107':    { inr: 5600000,  usd: 48900,  aed: 207900, gbp: 43900, eur: 51900 },
  'DSML108':    { inr: 5600000,  usd: 48900,  aed: 207900, gbp: 43900, eur: 51900 },
  'DSML109':    { inr: 3360000,  usd: 29900,  aed: 124900, gbp: 25900, eur: 30900 },
  'DSML110':    { inr: 3360000,  usd: 29900,  aed: 124900, gbp: 25900, eur: 30900 },
  'DSML111':    { inr: 5600000,  usd: 48900,  aed: 207900, gbp: 43900, eur: 51900 },
  'AR101':      { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'AR102':      { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'AR103':      { inr: 16800000, usd: 146900, aed: 622900, gbp: 129900,eur: 152900},
  'AI100STARTUP':{ inr: 5600000, usd: 48900,  aed: 207900, gbp: 43900, eur: 51900 },
  'AR104':      { inr: 2240000,  usd: 19900,  aed: 83900,  gbp: 17900, eur: 20900 },
  'CP101':      { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'CP102':      { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'CP103':      { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'CP104':      { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'GPT101':     { inr: 2240000,  usd: 19900,  aed: 83900,  gbp: 17900, eur: 20900 },
  'GPT102':     { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'GPT103':     { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'GPT104':     { inr: 500000,   usd: 4900,   aed: 18900,  gbp: 3900,  eur: 4900  },
  'GPT105':     { inr: 560000,   usd: 5900,   aed: 20900,  gbp: 4900,  eur: 5900  },
  'GPT106':     { inr: 4480000,  usd: 39900,  aed: 166900, gbp: 34900, eur: 40900 },
  'AI-102':     { inr: 4480000,  usd: 39900,  aed: 166900, gbp: 34900, eur: 40900 },
  'DP-100':     { inr: 4480000,  usd: 39900,  aed: 166900, gbp: 34900, eur: 40900 },
  'AI-900':     { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'AI-050':     { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'AI-3002':    { inr: 840000,   usd: 7900,   aed: 31900,  gbp: 6900,  eur: 7900  },
  'AI-3003':    { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'AI-3004':    { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'DP-3007':    { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'DP-3014':    { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  'PL-300':     { inr: 3360000,  usd: 29900,  aed: 124900, gbp: 25900, eur: 30900 },
  'AZ-204':     { inr: 3360000,  usd: 29900,  aed: 124900, gbp: 25900, eur: 30900 },
  'AZ-400T00':  { inr: 4480000,  usd: 39900,  aed: 166900, gbp: 34900, eur: 40900 },
  'AZ-104T00':  { inr: 4480000,  usd: 39900,  aed: 166900, gbp: 34900, eur: 40900 },
  'AZ-500T00':  { inr: 4480000,  usd: 39900,  aed: 166900, gbp: 34900, eur: 40900 },
  'SC-300T00':  { inr: 4480000,  usd: 39900,  aed: 166900, gbp: 34900, eur: 40900 },
  'AZ-900T00':  { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
  // Fallback for unrecognised courseIds
  default:      { inr: 1120000,  usd: 9900,   aed: 41900,  gbp: 8900,  eur: 10900 },
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
      if (p >= 5)  return 0.25; // 25% for 5–9
      if (p >= 2)  return 0.15; // 15% for 2–4
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

app.post('/api/coupons/validate', couponLimiter, (req, res) => {
  const { code, currency } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ valid: false, error: 'Missing code' });
  }
  const normalized = code.trim().toUpperCase();
  const coupon = validCoupons[normalized];
  if (coupon) {
    const curr = String(currency || '').toLowerCase();
    const allowed = coupon.currencies;
    if (allowed && curr && !allowed.includes(curr)) {
      return res.json({ valid: false, error: 'Coupon not valid for your region' });
    }
    return res.json({ valid: true, code: normalized, discountPercent: Math.round(coupon.rate * 100) });
  }
  return res.json({ valid: false });
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
    const { courseId, enrollmentType, participants, couponCode, currency, baseMajor, clientCalculatedTotal, clientCalculatedCouponDiscount, learner, courseInfo, referralCode } = req.body || {};

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
    const { courseId, enrollmentType, participants, couponCode, currency, baseMajor, clientCalculatedTotal, clientCalculatedCouponDiscount, learner, courseInfo, referralCode } = req.body || {};

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

    if (order.status !== 'paid') {
      await PendingOrder.updateOne({ orderId }, { $set: { status: 'paid', paidAt: Date.now(), razorpayPaymentId: razorpay_payment_id } });

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
    }

    return res.json({ success: true });
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
    const orderId = session?.metadata?.orderId;
    const amountTotal = session?.amount_total;
    const currency = session?.currency;
    const paymentStatus = session?.payment_status; // 'paid' expected

    const order = orderId ? await PendingOrder.findOne({ orderId }).lean() : null;
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (paymentStatus !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }
    if (order.expectedTotalMinor !== amountTotal || order.currency !== currency) {
      return res.status(400).json({ error: 'Amount or currency mismatch' });
    }

    // Mark order paid if not already
    if (order.status !== 'paid') {
      await PendingOrder.updateOne({ orderId }, { $set: { status: 'paid', paidAt: Date.now() } });

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

    return res.json({ success: true });
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

    const order = await PendingOrder.findOne({ orderId }).lean();
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    return res.json({
      orderId: order.orderId,
      courseId: order.courseId,
      courseInfo: order.courseInfo,
      learner: order.learner,
      enrollmentType: order.enrollmentType,
      participants: order.participants,
      currency: order.currency,
      unitAmountMinor: order.unitAmountMinor,
      quantity: order.quantity,
      expectedTotalMinor: order.expectedTotalMinor,
      status: order.status,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
    });
  } catch (err) {
    console.error('Get order error:', err);
    return res.status(500).json({ error: 'Failed to retrieve order' });
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
  }

  res.json({ received: true });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});