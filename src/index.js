// index.js

import dotenv from "dotenv";

// --- LOAD ENV BEFORE OTHER IMPORTS ---
dotenv.config();

import express from "express";
import cors from "cors";
import passport from "passport";
import Stripe from "stripe";
import { sendEmail, fromAddresses } from "./config/emailService.js";
import { generateEnrollmentDetailsForSales, generatePaymentSuccessEmail } from "./utils/emailTemplate.js";
const stripe = new Stripe(process.env.STRIPE_SECRET);

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
// --- Simple in-memory order store (replace with DB in production) ---
const orders = new Map();
const generateOrderId = () => `ord_${Math.random().toString(36).slice(2, 10)}`;

// --- Pricing utilities (Replace with DB/config-backed logic) ---
const allowedCurrencies = ['usd', 'inr', 'aed', 'eur', 'gbp'];

// Coupon map — single source of truth for both validation and quote computation
const validCoupons = {
  'SAVE20':    0.2,   // 20% off
  'SAVE30':    0.3,   // 30% off
  'TECH2026':  0.5,   // 50% off — flash sale
  'WELCOME10': 0.1,   // 10% off — new user welcome
  'SUMMER25':  0.25,  // 25% off — seasonal
  'FLAT10':    0.1,   // 10% off — legacy
};
const priceCatalog = {
  // courseId : base price (per individual) in MINOR units per currency
  default: { usd: 50000, inr: 400000, aed: 185000, eur: 46000, gbp: 39500 },
};

function getBasePriceMinor(courseId, currency) {
  const id = String(courseId);
  const curr = String(currency).toLowerCase();
  const val = priceCatalog[id]?.[curr] ?? priceCatalog.default?.[curr] ?? null;
  return typeof val === 'number' ? val : null;
}

function computeQuote({ courseId, enrollmentType, participants, currency, couponCode, baseMajor }) {
  const normalizedCurrency = String(currency || 'usd').toLowerCase();
  if (!allowedCurrencies.includes(normalizedCurrency)) {
    throw new Error('Unsupported currency');
  }
  const numParticipants = Number.isFinite(Number(participants)) && Number(participants) > 0
    ? Math.min(50, Math.max(1, Number(participants)))
    : 1;

  // Prefer explicit base price from client (major units), else fall back to catalog
  let basePriceMinor = null;
  if (Number.isFinite(Number(baseMajor)) && Number(baseMajor) > 0) {
    basePriceMinor = Math.round(Number(baseMajor) * 100);
  } else {
    basePriceMinor = getBasePriceMinor(courseId, normalizedCurrency);
  }
  if (!Number.isFinite(basePriceMinor) || basePriceMinor <= 0) {
    throw new Error('Price not configured for course/currency');
  }

  const getDiscountRate = (type, p) => {
    if (type === 'group') {
      if (p >= 5) return 0.5; // 50% for 5+
      if (p >= 2) return 0.4; // 40% for 2-4
      return 0.2; // fallback if p < 2
    }
    return 0.2; // individual
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

    const discountRate = validCoupons[code];
    if (discountRate !== undefined) {
      unitAmountMinor = Math.max(1, Math.round(unitAmountMinor * (1 - discountRate)));
      couponApplied = true;
      appliedCouponCode = code;
      couponDiscountRate = discountRate;
    } else if (code) {
      // Log invalid coupon codes for monitoring
      console.warn(`Invalid coupon code attempted: ${code}`);
    }
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
    totalDiscountPercent: Math.round((appliedDiscountRate + couponDiscountRate) * 100),
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

app.post('/api/coupons/validate', (req, res) => {
  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ valid: false, error: 'Missing code' });
  }
  const normalized = code.trim().toUpperCase();
  const rate = validCoupons[normalized];
  if (rate !== undefined) {
    return res.json({ valid: true, code: normalized, discountPercent: Math.round(rate * 100) });
  }
  return res.json({ valid: false });
});

app.post('/pricing/quote', async (req, res) => {
  try {
    const { courseId, enrollmentType, participants, couponCode, currency, baseMajor } = req.body || {};
    if (!courseId || !enrollmentType) {
      return res.status(400).json({ error: 'Missing required fields: courseId, enrollmentType' });
    }
    const quote = computeQuote({ courseId, enrollmentType, participants, currency, couponCode, baseMajor });
    return res.json(quote);
  } catch (err) {
    console.error('Quote error:', err.message);
    return res.status(400).json({ error: err.message || 'Failed to compute quote' });
  }
});

app.post('/stripe/checkout', async (req, res) => {
  try {
    const { courseId, enrollmentType, participants, couponCode, currency, baseMajor, clientCalculatedTotal, clientCalculatedCouponDiscount, learner, courseInfo } = req.body || {};

    if (!courseId || !enrollmentType) {
      return res.status(400).json({ error: 'Missing required fields: courseId, enrollmentType' });
    }
    const quote = computeQuote({ courseId, enrollmentType, participants, currency, couponCode, baseMajor });

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
    orders.set(orderId, {
      orderId,
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
      totalDiscountPercent: quote.totalDiscountPercent,
      status: 'pending',
      createdAt: Date.now(),
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

    if (!orderId || !orders.has(orderId)) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders.get(orderId);
    if (paymentStatus !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }
    if (order.expectedTotalMinor !== amountTotal || order.currency !== currency) {
      return res.status(400).json({ error: 'Amount or currency mismatch' });
    }

    // Mark order paid if not already
    if (order.status !== 'paid') {
      order.status = 'paid';
      order.paidAt = Date.now();
      orders.set(orderId, order);

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

    if (!orders.has(orderId)) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders.get(orderId);
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

    if (orderId && orders.has(orderId)) {
      const order = orders.get(orderId);
      if (order.expectedTotalMinor === amountTotal && order.currency === currency) {
        order.status = 'paid';
        order.paidAt = Date.now();
        orders.set(orderId, order);
        console.log('Order marked paid:', orderId);
      } else {
        console.warn('Order totals mismatch. Expected:', order.expectedTotalMinor, 'Got:', amountTotal);
        order.status = 'mismatch';
        orders.set(orderId, order);
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
app.use("/api/referral", referralRoutes);
app.use("/api/abandoned-enrollment", abandonedEnrollmentRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});