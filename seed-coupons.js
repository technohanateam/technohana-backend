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

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthlyFlash = MONTHS.map((m, i) => ({
  code: `${m}FLASH10`,
  discountPercent: 10,
  description: `${MONTH_NAMES[i]} Flash Sale — Global`,
  validCurrencies: null,
  isActive: true,
  startDate: s(i + 1, 1),
  expiryDate: new Date(YEAR, i + 1, 0, 23, 59, 59),
  notes: "Monthly flash sale — runs the full month, global",
}));

// Banner images live in the frontend's public/bar and public/promo folders (served same-origin).
const ANNOUNCEMENT_BANNERS = ["SEPFLASH10","BAHRAINDAY5","BLACKFRIDAY10","CYBERMONDAY10","DECFLASH10","DIWALI10","GURUPURAB5","HALLOWEEN5","NAVRATRI8","NOVFLASH10","OCTFLASH10","OMANDAY5","QATARDAY5","THANKSGIVING7","UAENATIONAL8","VETERANS5","XMAS10"];
const PROMO_BANNERS = ["SEPFLASH10","BAHRAINDAY5","BLACKFRIDAY10","CYBERMONDAY10","DECFLASH10","DIWALI10","GURUPURAB5","HALLOWEEN5","NAVRATRI8","NOVFLASH10","OCTFLASH10","OMANDAY5","QATARDAY5","THANKSGIVING7","UAENATIONAL8","VETERANS5","XMAS10"];
const bannerFields = (code) => ({
  ...(ANNOUNCEMENT_BANNERS.includes(code) && { announcementBannerUrl: `/bar/${code}.webp` }),
  ...(PROMO_BANNERS.includes(code) && { bannerImageUrl: `/promo/${code}.webp` }),
});

const coupons = [
  ...monthlyFlash,
  // ── India (INR) ───────────────────────────────────────────────────────────
  { code: "NEWYEAR5",      discountPercent: 5,  description: "New Year — Global",           validCurrencies: null,                  isActive: true,  expiryDate: d(1, 15),  notes: "Jan 1–15, global" },
  { code: "REPUBLIC5",     discountPercent: 5,  description: "Republic Day — India",        validCurrencies: ["inr"],               isActive: true,  expiryDate: d(1, 31),  notes: "Jan 26" },
  { code: "PONGAL5",       discountPercent: 5,  description: "Pongal / Makar Sankranti",    validCurrencies: ["inr"],               isActive: true,  expiryDate: d(1, 20),  notes: "Jan 14–16" },
  { code: "HOLI5",         discountPercent: 5,  description: "Holi Festival — India",       validCurrencies: ["inr"],               isActive: false, expiryDate: d(3, 31),  notes: "Activate ~Mar 20" },
  { code: "BAISAKHI5",     discountPercent: 5,  description: "Baisakhi — India",            validCurrencies: ["inr"],               isActive: false, expiryDate: d(4, 20),  notes: "Activate ~Apr 14" },
  { code: "INDEPENDENCE8", discountPercent: 8,  description: "Independence Day — India",    validCurrencies: ["inr"],               isActive: false, expiryDate: d(8, 20),  notes: "Activate ~Aug 15" },
  { code: "ONAM7",         discountPercent: 7,  description: "Onam — Kerala / India",       validCurrencies: ["inr"],               isActive: false, expiryDate: d(9, 30),  notes: "Activate ~Sep 5–15" },
  { code: "NAVRATRI8",     discountPercent: 8,  description: "Navratri — India",            validCurrencies: ["inr"],               isActive: true,  startDate: s(10, 9), expiryDate: d(10, 20), notes: "Sharad Navratri 2026 — Oct 11–19, Dussehra Oct 20" },
  { code: "DIWALI10",      discountPercent: 10, description: "Diwali — India",              validCurrencies: ["inr"],               isActive: true,  startDate: s(10, 20), expiryDate: d(11, 10), notes: "Diwali 2026 — Nov 8; early-bird from Oct 20" },
  { code: "RATHYATRA5",    discountPercent: 5,  description: "Rath Yatra Special",          validCurrencies: ["inr"],               isActive: true,  startDate: s(6, 20), expiryDate: d(6, 28),  notes: "Jagannath Rath Yatra 2026 — ~Jun 23" },
  { code: "EID_ADHA10",    discountPercent: 10, description: "Eid al-Adha Mubarak!",        validCurrencies: ["inr", "aed"],        isActive: true,  startDate: s(5, 25), expiryDate: d(6, 5),   notes: "Eid al-Adha 2026 — covers UAE + India (Bakrid)" },
  { code: "EID_ADHA_ME10", discountPercent: 10, description: "Eid al-Adha — Middle East",   validCurrencies: ["sar", "qar", "omr", "bhd", "kwd"], isActive: true, startDate: s(5, 25), expiryDate: d(6, 5), notes: "Eid al-Adha 2026 — Middle East (Saudi, Qatar, Oman, Bahrain, Kuwait)" },
  // ── UAE / Arab ────────────────────────────────────────────────────────────
  { code: "RAMADAN8",      discountPercent: 8,  description: "Ramadan — UAE/Arab",          validCurrencies: ["aed"],               isActive: false, expiryDate: d(4, 10),  notes: "Activate at Ramadan start (date varies)" },
  { code: "EID10",         discountPercent: 10, description: "Eid ul-Fitr / Adha — UAE",    validCurrencies: ["aed"],               isActive: false, expiryDate: d(6, 30),  notes: "Activate per Eid date" },
  { code: "ISLAMICNY5",    discountPercent: 5,  description: "Islamic New Year",            validCurrencies: ["aed"],               isActive: true,  startDate: s(6, 23), expiryDate: d(6, 30),  notes: "Hijri New Year 1448 AH — ~Jun 26, 2026" },
  { code: "UAENATIONAL8",  discountPercent: 8,  description: "UAE National Day",            validCurrencies: ["aed"],               isActive: true,  startDate: s(11, 28), expiryDate: d(12, 3),  notes: "UAE National Day Dec 2–3" },
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
  { code: "HALLOWEEN5",    discountPercent: 5,  description: "Halloween — US",              validCurrencies: ["usd"],               isActive: true,  startDate: s(10, 24), expiryDate: d(11, 2),  notes: "Halloween Oct 31" },
  { code: "THANKSGIVING7", discountPercent: 7,  description: "Thanksgiving — US",           validCurrencies: ["usd"],               isActive: true,  startDate: s(11, 20), expiryDate: d(11, 28), notes: "Thanksgiving Nov 26" },
  { code: "XMAS10",        discountPercent: 10, description: "Christmas — US/UK/EU",        validCurrencies: ["usd", "gbp", "eur"], isActive: true,  startDate: s(12, 15), expiryDate: d(12, 26), notes: "Christmas Dec 25" },
  { code: "VETERANS5", discountPercent: 5, description: "Veterans Day — US", validCurrencies: ["usd"], isActive: true, startDate: s(11, 9), expiryDate: d(11, 12), notes: "Veterans Day Nov 11" },
  { code: "OMANDAY5", discountPercent: 5, description: "Oman National Day", validCurrencies: ["omr"], isActive: true, startDate: s(11, 16), expiryDate: d(11, 19), notes: "Oman National Day Nov 18" },
  { code: "GURUPURAB5", discountPercent: 5, description: "Guru Nanak Jayanti — India", validCurrencies: ["inr"], isActive: true, startDate: s(11, 22), expiryDate: d(11, 25), notes: "Guru Nanak Jayanti ~Nov 24" },
  { code: "BLACKFRIDAY10", discountPercent: 10, description: "Black Friday — US/UK/EU", validCurrencies: ["usd", "gbp", "eur"], isActive: true, startDate: s(11, 26), expiryDate: d(11, 30), notes: "Black Friday Nov 27" },
  { code: "CYBERMONDAY10", discountPercent: 10, description: "Cyber Monday — Global", validCurrencies: null, isActive: true, startDate: s(11, 30), expiryDate: d(12, 1), notes: "Cyber Monday Nov 30" },
  { code: "BAHRAINDAY5", discountPercent: 5, description: "Bahrain National Day", validCurrencies: ["bhd"], isActive: true, startDate: s(12, 14), expiryDate: d(12, 17), notes: "Bahrain National Day Dec 16" },
  { code: "QATARDAY5", discountPercent: 5, description: "Qatar National Day", validCurrencies: ["qar"], isActive: true, startDate: s(12, 16), expiryDate: d(12, 19), notes: "Qatar National Day Dec 18" },
  // ── Global / Platform ─────────────────────────────────────────────────────
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
        ...bannerFields(c.code.toUpperCase()),
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
