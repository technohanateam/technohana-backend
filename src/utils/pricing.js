import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

export const allowedCurrencies = ['usd', 'inr', 'aed', 'eur', 'gbp', 'sar', 'qar', 'omr', 'bhd', 'kwd'];

// Coupon map — single source of truth for both validation and quote computation
// currencies: null means global (any currency); otherwise array of allowed currency codes
export const validCoupons = {
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
  'RATHYATRA5':     { rate: 0.05, currencies: ['inr'] },       // Jun 20–28 — Rath Yatra
  // ── UAE / Arab ────────────────────────────────────────────────────────────
  'RAMADAN8':       { rate: 0.08, currencies: ['aed'] },       // Mar/Apr — Ramadan
  'EID10':          { rate: 0.10, currencies: ['aed'] },       // Apr/Jun — Eid ul-Fitr / Adha
  'EID_ADHA10':     { rate: 0.10, currencies: ['inr', 'aed'] }, // May 25–Jun 5 — Eid al-Adha / Bakrid
  'EID_ADHA_ME10':  { rate: 0.10, currencies: ['sar', 'qar', 'omr', 'bhd', 'kwd'] }, // May 25–Jun 5 — Eid al-Adha / Middle East
  'ISLAMICNY5':     { rate: 0.05, currencies: ['aed'] },       // Jun 23–30 — Islamic New Year
  'UAENATIONAL8':   { rate: 0.08, currencies: ['aed'] },       // Dec 2  — UAE National Day
  // ── US ────────────────────────────────────────────────────────────────────
  'MEMORIALDAY5':   { rate: 0.05, currencies: ['usd'] },       // May    — Memorial Day
  'JUNETEENTH5':    { rate: 0.05, currencies: ['usd'] },       // Jun 19 — Juneteenth
  'FATHERSDAY7':    { rate: 0.07, currencies: null },          // Jun 15–22 — Father's Day (global)
  'LABORDAY7':      { rate: 0.07, currencies: ['usd'] },       // Sep    — Labor Day
  'HALLOWEEN5':     { rate: 0.05, currencies: ['usd'] },       // Oct 31 — Halloween
  'THANKSGIVING7':  { rate: 0.07, currencies: ['usd'] },       // Nov    — Thanksgiving
  'XMAS10':         { rate: 0.10, currencies: ['usd', 'gbp', 'eur'] }, // Dec — Christmas
  // ── UK / EU ───────────────────────────────────────────────────────────────
  'STPATRICKS5':    { rate: 0.05, currencies: ['gbp', 'eur'] }, // Mar 17 — St. Patrick's Day
  'EASTER6':        { rate: 0.06, currencies: ['gbp', 'eur'] }, // Apr    — Easter
  'MAYBANK5':       { rate: 0.05, currencies: ['gbp', 'eur'] }, // May    — May Bank Holiday
  'CORPUSCHRISTI5': { rate: 0.05, currencies: ['eur'] },        // Jun 1–7 — Corpus Christi (EU)
  'MIDSUMMER5':     { rate: 0.05, currencies: ['eur'] },        // Jun 20–28 — Midsummer / St John's Day
  'SUMMERLEARN7':   { rate: 0.07, currencies: ['usd', 'gbp', 'eur'] }, // Jun–Aug — Summer Learning
  // ── Global / Platform ─────────────────────────────────────────────────────
  'LAUNCH10':       { rate: 0.10, currencies: null },          // Always-on platform launch
  'FLASHSALE15':    { rate: 0.15, currencies: null },          // On-demand flash sale — activate manually
  'REFERRAL10':     { rate: 0.10, currencies: null },          // Referral campaign codes — activate per campaign
  'B2B20':          { rate: 0.20, currencies: null },          // Corporate / B2B deals — activate per deal
};

const _priceCatalogPath = resolve(dirname(fileURLToPath(import.meta.url)), '../data/courses.json');
const _rawCourses = JSON.parse(fs.readFileSync(_priceCatalogPath, 'utf-8'));
const priceCatalog = {};
for (const c of _rawCourses) {
  if (c.id && c.prices) {
    priceCatalog[c.id] = {
      inr: Math.round((c.prices.inr ?? c.price ?? 0) * 100),
      usd: Math.round((c.prices.usd ?? 0) * 100),
      aed: Math.round((c.prices.aed ?? 0) * 100),
      gbp: Math.round((c.prices.gbp ?? 0) * 100),
      eur: Math.round((c.prices.eur ?? 0) * 100),
    };
  }
}
priceCatalog.default = {
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

export function getBasePriceMinor(courseId, currency) {
  const id = String(courseId);
  const curr = String(currency).toLowerCase();
  const val = priceCatalog[id]?.[curr] ?? priceCatalog.default?.[curr] ?? null;
  return typeof val === 'number' ? val : null;
}

export function computeQuote({ courseId, enrollmentType, participants, currency, couponCode, baseMajor, referralDiscountRate }) {
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
      return 0.15;
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

  const appliedReferralRate = (Number.isFinite(Number(referralDiscountRate)) && Number(referralDiscountRate) > 0)
    ? Math.min(0.5, Number(referralDiscountRate))
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
