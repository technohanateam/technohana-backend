/**
 * seed-coupons.js — Full annual coupon calendar
 * Run: node seed-coupons.js
 *
 * Upserts each coupon by code — safe to re-run.
 * Existing coupons are NOT overwritten (skip on conflict).
 * Seasonal coupons start as inactive; activate from Admin → Coupons when needed.
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import connectDb from "./config/db.js";
import Coupon from "./src/models/coupon.model.js";

const YEAR = new Date().getFullYear();
const d = (month, day) => new Date(YEAR, month - 1, day, 23, 59, 59);

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
  // ── UAE / Arab ────────────────────────────────────────────────────────────
  { code: "RAMADAN8",      discountPercent: 8,  description: "Ramadan — UAE/Arab",          validCurrencies: ["aed"],               isActive: false, expiryDate: d(4, 10),  notes: "Activate at Ramadan start (date varies)" },
  { code: "EID10",         discountPercent: 10, description: "Eid ul-Fitr / Adha — UAE",    validCurrencies: ["aed"],               isActive: false, expiryDate: d(6, 30),  notes: "Activate per Eid date" },
  { code: "UAENATIONAL8",  discountPercent: 8,  description: "UAE National Day",            validCurrencies: ["aed"],               isActive: false, expiryDate: d(12, 10), notes: "Dec 2–3" },
  // ── US ────────────────────────────────────────────────────────────────────
  { code: "STPATRICKS5",   discountPercent: 5,  description: "St. Patrick's Day — UK/EU",  validCurrencies: ["gbp", "eur"],        isActive: false, expiryDate: d(3, 20),  notes: "Mar 17" },
  { code: "EASTER6",       discountPercent: 6,  description: "Easter — UK/EU",              validCurrencies: ["gbp", "eur"],        isActive: false, expiryDate: d(4, 30),  notes: "Date varies Apr" },
  { code: "MEMORIALDAY5",  discountPercent: 5,  description: "Memorial Day — US",           validCurrencies: ["usd"],               isActive: false, expiryDate: d(5, 31),  notes: "Last Mon of May" },
  { code: "MAYBANK5",      discountPercent: 5,  description: "May Bank Holiday — UK/EU",    validCurrencies: ["gbp", "eur"],        isActive: false, expiryDate: d(5, 10),  notes: "First Mon of May" },
  { code: "JUNETEENTH5",   discountPercent: 5,  description: "Juneteenth — US",             validCurrencies: ["usd"],               isActive: false, expiryDate: d(6, 25),  notes: "Jun 19" },
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

  let inserted = 0;
  let skipped = 0;

  for (const c of coupons) {
    const exists = await Coupon.findOne({ code: c.code.toUpperCase() });
    if (exists) {
      console.log(`  skip  ${c.code}`);
      skipped++;
      continue;
    }
    await Coupon.create({
      code: c.code.toUpperCase(),
      discountPercent: c.discountPercent,
      description: c.description,
      validCurrencies: c.validCurrencies ?? null,
      isActive: c.isActive,
      expiryDate: c.expiryDate ?? null,
      maxUsageCount: null,
      notes: c.notes,
    });
    console.log(`  added ${c.code} (${c.isActive ? "active" : "inactive"})`);
    inserted++;
  }

  console.log(`\nDone — ${inserted} inserted, ${skipped} skipped.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
