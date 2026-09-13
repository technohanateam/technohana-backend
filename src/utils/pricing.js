import Course from '../models/course.model.js';
import Coupon from '../models/coupon.model.js';

export const allowedCurrencies = ['usd', 'inr', 'aed', 'eur', 'gbp', 'sar', 'qar', 'omr', 'bhd', 'kwd'];

const DEFAULT_PRICES = {
  inr: 1599900,
  usd: 14900,
  aed: 59900,
  gbp: 12900,
  eur: 14900,
  sar: 58800,
  qar: 54400,
  omr: 57800,
  bhd: 56800,
  kwd: 45900,
};

// In-memory mirror of Course.prices, rebuilt from MongoDB so checkout pricing
// reflects admin edits immediately instead of a stale file read at process
// startup. Refreshed at boot and again whenever an admin create/update/delete
// touches the Course collection (see refreshPriceCatalog callers).
let priceCatalog = { default: DEFAULT_PRICES };

export async function refreshPriceCatalog() {
  const courses = await Course.find({}, 'id price prices').lean();
  const next = { default: DEFAULT_PRICES };
  for (const c of courses) {
    if (c.id && c.prices) {
      next[c.id] = {
        inr: Math.round((c.prices.inr ?? c.price ?? 0) * 100),
        usd: Math.round((c.prices.usd ?? 0) * 100),
        aed: Math.round((c.prices.aed ?? 0) * 100),
        gbp: Math.round((c.prices.gbp ?? 0) * 100),
        eur: Math.round((c.prices.eur ?? 0) * 100),
      };
    }
  }
  priceCatalog = next;
  return priceCatalog;
}

export function getBasePriceMinor(courseId, currency) {
  const id = String(courseId);
  const curr = String(currency).toLowerCase();
  // An unrecognised courseId must not resolve to the default price: that turns a
  // stale catalog (priceCatalog not yet refreshed for a brand-new course) into a
  // silently undercharged payment rather than a visible error. A *known* course
  // still falls back per-currency — no course carries sar/qar/omr/bhd/kwd prices,
  // so the Gulf currencies are served entirely by the default block.
  if (id === 'default' || !priceCatalog[id]) return null;
  const val = priceCatalog[id][curr] ?? priceCatalog.default?.[curr] ?? null;
  return typeof val === 'number' ? val : null;
}

export async function computeQuote({ courseId, enrollmentType, participants, currency, couponCode, baseMajor, referralDiscountRate }) {
  const normalizedCurrency = String(currency || 'usd').toLowerCase();
  if (!allowedCurrencies.includes(normalizedCurrency)) {
    throw new Error('Unsupported currency');
  }
  const numParticipants = Number.isFinite(Number(participants)) && Number(participants) > 0
    ? Math.min(50, Math.max(1, Number(participants)))
    : 1;

  let basePriceMinor = null;
  basePriceMinor = getBasePriceMinor(courseId, normalizedCurrency);
  if (!Number.isFinite(basePriceMinor) || basePriceMinor <= 0) {
    throw new Error('Price not configured for course/currency');
  }

  const getDiscountRate = (type, p) => {
    if (type === 'group') {
      if (p >= 10) return 0.35;
      if (p >= 5) return 0.25;
      if (p >= 2) return 0.15;
      return 0; // "group" claimed with fewer than 2 participants doesn't qualify — treat as individual
    }
    return 0;
  };

  let unitAmountMinor = 0;
  let quantity = numParticipants;
  let originalUnitMinor = basePriceMinor;

  const appliedDiscountRate = getDiscountRate(enrollmentType, numParticipants);
  unitAmountMinor = Math.max(1, Math.round(originalUnitMinor * (1 - appliedDiscountRate)));

  let couponApplied = false;
  let appliedCouponCode = null;
  let couponDiscountRate = 0;

  // Coupons are the single source of truth in MongoDB (Coupon model) — the
  // same document coupon.controller.js's admin CRUD and public /validate
  // endpoint use, so isActive/expiry/usage-limit/currency rules are enforced
  // identically here at actual checkout time, not just at UI-validation time.
  if (couponCode && typeof couponCode === 'string') {
    const code = couponCode.trim().toUpperCase();
    const coupon = await Coupon.findOne({ code });
    if (
      coupon &&
      coupon.isActive &&
      coupon.hasStarted() &&
      !coupon.isExpired() &&
      !coupon.isExhausted() &&
      coupon.isValidForCurrency(normalizedCurrency)
    ) {
      const rate = coupon.discountPercent / 100;
      unitAmountMinor = Math.max(1, Math.round(unitAmountMinor * (1 - rate)));
      couponApplied = true;
      appliedCouponCode = code;
      couponDiscountRate = rate;
    } else if (code) {
      console.warn(`Invalid or inapplicable coupon code attempted: ${code}`);
    }
  }

  const appliedReferralRate = (Number.isFinite(Number(referralDiscountRate)) && Number(referralDiscountRate) > 0)
    ? Math.min(0.5, Number(referralDiscountRate))
    : 0;
  if (appliedReferralRate > 0) {
    unitAmountMinor = Math.max(1, Math.round(unitAmountMinor * (1 - appliedReferralRate)));
  }

  // Enrollment + coupon + referral together must never exceed 50% off,
  // matching the same floor applyManualDiscount() enforces below.
  const floorUnitMinor = Math.ceil(originalUnitMinor * 0.5);
  unitAmountMinor = Math.max(floorUnitMinor, unitAmountMinor);

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

// Applies an additional manual discount on top of the standard chain.
// Cap: requested 0–25%, combined total capped at 50% (floor = 50% of original price).
export function applyManualDiscount(quote, manualDiscountPercent) {
  const requested = Math.min(25, Math.max(0, Number(manualDiscountPercent) || 0));
  if (requested === 0) {
    return { ...quote, manualDiscountPercent: 0, manualDiscountCapped: false };
  }
  const floorUnit = Math.ceil(quote.originalUnitMinor * 0.5);
  let unit = Math.round(quote.unitAmountMinor * (1 - requested / 100));
  const capped = unit < floorUnit;
  unit = Math.max(floorUnit, Math.max(1, unit));
  return {
    ...quote,
    unitAmountMinor: unit,
    expectedTotalMinor: unit * quote.quantity,
    manualDiscountPercent: requested,
    manualDiscountCapped: capped,
    totalDiscountPercent: Math.round((1 - unit / quote.originalUnitMinor) * 100),
  };
}
