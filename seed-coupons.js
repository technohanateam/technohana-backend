import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import connectDb from "./config/db.js";
import Coupon from "./models/coupon.model.js";

// Legacy hardcoded coupons to migrate
const legacyCoupons = [
  {
    code: "DIWALI10",
    discountPercent: 10,
    description: "Diwali Festival Offer",
    validCurrencies: ["inr"],
    isActive: true,
    maxUsageCount: null,
    notes: "Festival coupon - migrated from hardcoded data",
  },
  {
    code: "HOLI5",
    discountPercent: 5,
    description: "Holi Festival Offer",
    validCurrencies: ["inr"],
    isActive: true,
    maxUsageCount: null,
    notes: "Festival coupon - migrated from hardcoded data",
  },
  {
    code: "EID10",
    discountPercent: 10,
    description: "Eid Al-Fitr & Eid Al-Adha Offer",
    validCurrencies: ["aed"],
    isActive: true,
    maxUsageCount: null,
    notes: "Festival coupon - migrated from hardcoded data",
  },
  {
    code: "RAMADAN8",
    discountPercent: 8,
    description: "Ramadan Special Offer",
    validCurrencies: ["aed"],
    isActive: true,
    maxUsageCount: null,
    notes: "Festival coupon - migrated from hardcoded data",
  },
  {
    code: "XMAS10",
    discountPercent: 10,
    description: "Christmas Special Offer",
    validCurrencies: ["usd", "gbp", "eur"],
    isActive: true,
    maxUsageCount: null,
    notes: "Festival coupon - migrated from hardcoded data",
  },
  {
    code: "THANKSGIVING7",
    discountPercent: 7,
    description: "Thanksgiving Offer",
    validCurrencies: ["usd"],
    isActive: true,
    maxUsageCount: null,
    notes: "Festival coupon - migrated from hardcoded data",
  },
  {
    code: "EASTER6",
    discountPercent: 6,
    description: "Easter Offer",
    validCurrencies: ["gbp", "eur"],
    isActive: true,
    maxUsageCount: null,
    notes: "Festival coupon - migrated from hardcoded data",
  },
  {
    code: "NEWYEAR5",
    discountPercent: 5,
    description: "New Year Global Offer",
    validCurrencies: [],
    isActive: true,
    maxUsageCount: null,
    notes: "Global coupon - migrated from hardcoded data",
  },
  {
    code: "LAUNCH10",
    discountPercent: 10,
    description: "Platform Launch Offer",
    validCurrencies: [],
    isActive: true,
    maxUsageCount: null,
    notes: "Global coupon - migrated from hardcoded data",
  },
];

async function seedCoupons() {
  try {
    await connectDb();
    console.log("✓ Connected to MongoDB");

    // Check if coupons already exist
    const existingCount = await Coupon.countDocuments();
    if (existingCount > 0) {
      console.log(`⚠ Found ${existingCount} existing coupons. Skipping seed.`);
      console.log("To reseed, delete existing coupons first or use --force flag.");
      process.exit(0);
    }

    // Insert legacy coupons
    const result = await Coupon.insertMany(legacyCoupons);
    console.log(`✓ Successfully seeded ${result.length} coupons:`);
    result.forEach((coupon) => {
      console.log(`  - ${coupon.code}: ${coupon.discountPercent}%`);
    });

    console.log("\n✓ Migration complete! Coupons are now in the database.");
    console.log("You can manage them from the Admin Panel → Coupons");

    process.exit(0);
  } catch (error) {
    console.error("✗ Error seeding coupons:", error.message);
    process.exit(1);
  }
}

seedCoupons();
