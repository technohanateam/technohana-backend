/**
 * seed-coupons.js — Full annual coupon calendar
 * Run: node seed-coupons.js
 *
 * Upserts each coupon by code — safe to re-run.
 * Existing coupons are updated with new startDate, expiryDate, isActive status.
 * Seasonal coupons start as inactive; activate from Admin → Coupons when needed.
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import connectDb from "./src/config/db.js";
import Coupon from "./src/models/coupon.model.js";

const YEAR = new Date().getFullYear();
const d = (month, day) => new Date(YEAR, month - 1, day, 23, 59, 59);
const s = (month, day) => new Date(YEAR, month - 1, day, 0, 0, 0); // startDate

const coupons = [
  // ── India (INR) ───────────────────────────────────────────────────────────
  { code: "NEWYEAR5",      discountPercent: 5,  description: "New Year — Global",           validCurrencies: null,                  isActive: true,  expiryDate: d(1, 15),  notes: "Jan 1–15, global" },
  { code: "REPUBLIC5",     discountPercent: 5,  description: "Republic Day — India",        validCurrencies: ["inr"],               isActive: true,  expiryDate: d(1, 31),  notes: "Jan 26" },
  { code: "PONGAL5",       discountPercent: 5,  description: "Pongal / Makar Sankranti",    validCurrencies: ["inr"],               isActive: true,  expiryDate: d(1, 20),  notes: "Jan 14–16" },
  { code: "HOLI5",         discountPercent: 5,  description: "Holi Festival — India",       validCurrencies: ["inr"],               isActive: false, expiryDate: d(3, 31),  notes: "Activate ~Mar 20" },
  { code: "BAISAKHI5",     discountPercent: 5,  description: "Baisakhi — India",            validCurrencies: ["inr"],               isActive: false, expiryDate: d(4, 20),  notes: "Activate ~Apr 14" },
  { code: "INDEPENDENCE8", discountPercent: 8,  description: "Independence Day — India",    validCurrencies: ["inr"],               isActive: false, expiryDate: d(8, 20),  notes: "Activate ~Aug 15" },
  { code: "ONAM7",         discountPercent: 7,  description: "Onam — Kerala / India",       validCurrencies: ["inr"],               isActive: false, expiryDate: d(9, 30),  notes: "Activate ~Sep 5–15" },
  { code: "NAVRATRI8",     discountPercent: 8,  description: "Navratri — India",            validCurrencies: ["inr"],               isActive: false, expiryDate: d(10, 20), notes: "Activate ~Oct 2–12" },
  { code: "DIWALI10",      discountPercent: 10, description: "Diwali — India",              validCurrencies: ["inr"],               isActive: false, expiryDate: d(11, 10), notes: "Activate ~Oct 20 (date varies)" },
  { code: "RATHYATRA5",    discountPercent: 5,  description: "Rath Yatra Special",          validCurrencies: ["inr"],               isActive: true,  startDate: s(6, 20), expiryDate: d(6, 28),  notes: "Jagannath Rath Yatra 2026 — ~Jun 23" },
  { code: "EID_ADHA10",    discountPercent: 10, description: "Eid al-Adha Mubarak!",        validCurrencies: ["inr", "aed"],        isActive: true,  startDate: s(5, 25), expiryDate: d(6, 5),   notes: "Eid al-Adha 2026 — covers UAE + India (Bakrid)" },
  { code: "EID_ADHA_ME10", discountPercent: 10, description: "Eid al-Adha — Middle East",   validCurrencies: ["sar", "qar", "omr", "bhd", "kwd"], isActive: true, startDate: s(5, 25), expiryDate: d(6, 5), notes: "Eid al-Adha 2026 — Middle East (Saudi, Qatar, Oman, Bahrain, Kuwait)" },
  // ── UAE / Arab ────────────────────────────────────────────────────────────
  { code: "RAMADAN8",      discountPercent: 8,  description: "Ramadan — UAE/Arab",          validCurrencies: ["aed"],               isActive: false, expiryDate: d(4, 10),  notes: "Activate at Ramadan start (date varies)" },
  { code: "EID10",         discountPercent: 10, description: "Eid ul-Fitr / Adha — UAE",    validCurrencies: ["aed"],               isActive: false, expiryDate: d(6, 30),  notes: "Activate per Eid date" },
  { code: "ISLAMICNY5",    discountPercent: 5,  description: "Islamic New Year",            validCurrencies: ["aed"],               isActive: true,  startDate: s(6, 23), expiryDate: d(6, 30),  notes: "Hijri New Year 1448 AH — ~Jun 26, 2026" },
  { code: "UAENATIONAL8",  discountPercent: 8,  description: "UAE National Day",            validCurrencies: ["aed"],               isActive: false, expiryDate: d(12, 10), notes: "Dec 2–3" },
  // ── US ────────────────────────────────────────────────────────────────────
  { code: "STPATRICKS5",   discountPercent: 5,  description: "St. Patrick's Day — UK/EU",  validCurrencies: ["gbp", "eur"],        isActive: false, expiryDate: d(3, 20),  notes: "Mar 17" },
  { code: "EASTER6",       discountPercent: 6,  description: "Easter — UK/EU",              validCurrencies: ["gbp", "eur"],        isActive: false, expiryDate: d(4, 30),  notes: "Date varies Apr" },
  { code: "MEMORIALDAY5",  discountPercent: 5,  description: "Memorial Day — US",           validCurrencies: ["usd"],               isActive: false, expiryDate: d(5, 31),  notes: "Last Mon of May" },
  { code: "MAYBANK5",      discountPercent: 5,  description: "May Bank Holiday — UK/EU",    validCurrencies: ["gbp", "eur"],        isActive: false, expiryDate: d(5, 10),  notes: "First Mon of May" },
  { code: "JUNETEENTH5",   discountPercent: 5,  description: "Juneteenth — US",             validCurrencies: ["usd"],               isActive: true,  startDate: s(6, 15), expiryDate: d(6, 22),  notes: "Jun 19" },
  { code: "CORPUSCHRISTI5", discountPercent: 5, description: "Corpus Christi Sale",        validCurrencies: ["eur"],               isActive: true,  startDate: s(6, 1),  expiryDate: d(6, 7),   notes: "EU Catholic holiday — DE, AT, ES, IT, PL" },
  { code: "FATHERSDAY7",   discountPercent: 7,  description: "Father's Day Special",        validCurrencies: null,                  isActive: true,  startDate: s(6, 15), expiryDate: d(6, 22),  notes: "Father's Day 2026 — global campaign" },
  { code: "MIDSUMMER5",    discountPercent: 5,  description: "Midsummer Sale",              validCurrencies: ["eur"],               isActive: true,  startDate: s(6, 20), expiryDate: d(6, 28),  notes: "Midsummer / St John's Day — Scandinavia & Baltics" },
  { code: "SUMMERLEARN7",  discountPercent: 7,  description: "Summer Learning — US/UK/EU",  validCurrencies: ["usd", "gbp", "eur"], isActive: false, expiryDate: d(8, 31),  notes: "Jun–Aug" },
  { code: "LABORDAY7",     discountPercent: 7,  description: "Labor Day — US",              validCurrencies: ["usd"],               isActive: false, expiryDate: d(9, 10),  notes: "First Mon of Sep" },
  { code: "HALLOWEEN5",    discountPercent: 5,  description: "Halloween — US",              validCurrencies: ["usd"],               isActive: false, expiryDate: d(11, 2),  notes: "Oct 31" },
  { code: "THANKSGIVING7", discountPercent: 7,  description: "Thanksgiving — US",           validCurrencies: ["usd"],               isActive: false, expiryDate: d(12, 1),  notes: "4th Thu of Nov" },
  { code: "XMAS10",        discountPercent: 10, description: "Christmas — US/UK/EU",        validCurrencies: ["usd", "gbp", "eur"], isActive: false, expiryDate: d(12, 31), notes: "Dec 24–31" },
  // ── Global / Platform ─────────────────────────────────────────────────────
  { code: "LAUNCH10",      discountPercent: 10, description: "Platform Launch — Global",    validCurrencies: null,                  isActive: true,  expiryDate: null,      notes: "Always-on" },
  { code: "FLASHSALE15",   discountPercent: 15, description: "Flash Sale — Global",         validCurrencies: null,                  isActive: false, expiryDate: null,      notes: "Activate manually for flash sales" },
  { code: "REFERRAL10",    discountPercent: 10, description: "Referral Campaign — Global",  validCurrencies: null,                  isActive: false, expiryDate: null,      notes: "Activate per referral campaign" },
  { code: "B2B20",         discountPercent: 20, description: "Corporate / B2B Deal",        validCurrencies: null,                  isActive: false, expiryDate: null,      notes: "Share directly with corporate clients" },
];

async function seed() {
  await connectDb();
  console.log("✓ Connected to MongoDB\n");

  let upserted = 0;

  for (const c of coupons) {
    await Coupon.updateOne(
      { code: c.code.toUpperCase() },
      {
        code: c.code.toUpperCase(),
        discountPercent: c.discountPercent,
        description: c.description,
        validCurrencies: c.validCurrencies ?? null,
        isActive: c.isActive,
        startDate: c.startDate ?? null,
        expiryDate: c.expiryDate ?? null,
        maxUsageCount: null,
        notes: c.notes,
      },
      { upsert: true }
    );
    console.log(`  ${c.isActive ? '✓ active ' : '  inactive'} ${c.code}`);
    upserted++;
  }

  console.log(`\nDone — ${upserted} upserted.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
