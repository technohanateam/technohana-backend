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
import { encryptToken } from "./utils/tokenCrypto.js";
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
import leadCaptureRoutes from "./routes/leadCapture.routes.js";
import instructorRoutes from "./routes/instructor.routes.js";
import skillsGapRoutes from "./routes/skillsGap.routes.js";
import crmRoutes from "./routes/crm.routes.js";
import Coupon from "./models/coupon.model.js";
import { validateCoupon, incrementCouponUsage } from "./controllers/coupon.controller.js";
import { handleResendWebhook } from "./services/resendWebhook.js";
import { registerCampaignEventListeners, emitCampaignEvent } from "./services/campaignEventTrigger.js";
import { generateRecoveryEmail } from "./services/recoveryEmailAgent.js";
import Enquiry from "./models/enquiry.model.js";
import { authenticateAdmin, requirePage } from "./middleware/authenticateAdmin.js";
import { authenticateJWT } from "./middleware/authenticateJWT.js";
import { Order } from "./models/order.model.js";
import { computeQuote } from './utils/pricing.js';

const app = express();
app.set('trust proxy', 1); // trust first proxy (Render/Railway/Vercel reverse proxy)

// Health check endpoint — registered before CORS middleware so Railway's
// server-to-server healthcheck requests (which have no Origin header) are not blocked.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const allowedOrigins = process.env.WHITELISTED_URLS
  ? process.env.WHITELISTED_URLS.split(',').map(url => url.trim())
  : [];

// Routes hit by the Hana Agent (Python service) via server-to-server POSTs,
// which never carry a browser Origin header — exempt them from the
// Origin-required-in-production check below (same reasoning as /health).
const noOriginRequiredPaths = ['/enquiry', '/skills-gap/email-plan'];

const corsOptionsDelegate = function (req, callback) {
  const exemptFromOriginRequirement = !req.headers.origin && noOriginRequiredPaths.includes(req.path);
  callback(null, {
    origin: function (origin, cb) {
      if (!origin) {
        if (exemptFromOriginRequirement) {
          return cb(null, true);
        }
        if (process.env.NODE_ENV === 'production') {
          return cb(new Error("Origin required in production"));
        }
        return cb(null, true);
      }
      if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
        return cb(null, true);
      } else if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') {
        return cb(null, true);
      } else {
        return cb(new Error("Not allowed by CORS"));
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
  });
};
app.use(cors(corsOptionsDelegate));
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

// --- Pricing utilities ---


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
      $and: [
        { $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }] },
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
      ],
    };

    // Try regional coupon first (matches the user's currency), then fall back to global
    const pick = async (currencyFilter) => {
      const candidates = await Coupon.find({ ...baseFilter, ...currencyFilter })
        .sort({ discountPercent: -1 }).limit(10).lean();
      return candidates.find(c => c.maxUsageCount == null || c.currentUsageCount < c.maxUsageCount) || null;
    };

    let coupon = null;
    if (currency) {
      coupon = await pick({ validCurrencies: { $in: [currency] } });
    }
    if (!coupon) {
      coupon = await pick({ $or: [{ validCurrencies: null }, { validCurrencies: { $size: 0 } }] });
    }

    // Fallback: find any active coupon with announcementBannerUrl set
    let announcementBannerUrl = coupon?.announcementBannerUrl || null;
    if (!announcementBannerUrl) {
      const bannerCoupon = await Coupon.findOne({
        isActive: true,
        $and: [
          { $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }] },
          { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        ],
        announcementBannerUrl: { $exists: true, $ne: null, $ne: "" },
      }).sort({ discountPercent: -1 }).lean();
      announcementBannerUrl = bannerCoupon?.announcementBannerUrl || null;
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
        bannerImageUrl: coupon.bannerImageUrl || null,
        announcementBannerUrl: announcementBannerUrl,
        startDate: coupon.startDate || null,
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
      const enrollmentToken = encryptToken({ orderId, email: order.learner.email, paidAt });
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

      const enrollmentToken = encryptToken({ orderId, email: order.learner.email, timestamp: Date.now() });
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
        const enrollmentToken = encryptToken({ orderId: oid, email: o.learner.email, paidAt });
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
      const enrollmentToken = encryptToken({ orderId, email: order.learner.email, timestamp: Date.now() });

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

// Get order details by orderId — requires ownership: logged-in user's email must match the order
app.get('/payments/order/:orderId', authenticateJWT, async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId' });
    }

    const order = (await Order.findOne({ orderId }).lean()) || (await PendingOrder.findOne({ orderId }).lean());
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.learner?.email !== req.user?.email) {
      return res.status(403).json({ error: 'Forbidden' });
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

app.get('/admin/utm-report', authenticateAdmin, requirePage("utm-report"), async (req, res) => {
  try {
    const { from, to } = req.query;
    const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
    if (from && !isValidDate(from)) return res.status(400).json({ message: "Invalid 'from' date. Use YYYY-MM-DD." });
    if (to && !isValidDate(to)) return res.status(400).json({ message: "Invalid 'to' date. Use YYYY-MM-DD." });
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
app.use("/", assessmentResultRoutes);
app.use("/admin", seoGeoRoutes);
app.use("/", leadCaptureRoutes);
app.use("/instructor", instructorRoutes);
app.use("/", skillsGapRoutes);
app.use("/api/crm", authenticateAdmin, crmRoutes);

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
        // AI-personalized recovery email; falls back to the static template
        const aiEmail = await generateRecoveryEmail(user);
        await sendEmail({
          from: fromAddresses.sales,
          to: user.email,
          subject: aiEmail?.subject || "You left something behind — complete your enrollment",
          html: aiEmail?.html || generateAbandonedCartEmail({
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