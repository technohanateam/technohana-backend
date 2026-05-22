/**
 * One-shot script to create an admin user in MongoDB.
 * Usage: node create-admin.js
 * Requires MONGO_URI in .env
 *
 * Generates a secure random password and prints it once — save it immediately.
 */
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import AdminUser from "./src/models/adminUser.model.js";

const EMAIL = "abdul@technohana.com";
const ROLE = "admin";
const NAME = "Abdul";

const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
const bytes = crypto.randomBytes(16);
const password = Array.from(bytes).map((b) => chars[b % chars.length]).join("");

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("Error: MONGO_URI is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const existing = await AdminUser.findOne({ email: EMAIL });
  if (existing) {
    console.log(`Admin user ${EMAIL} already exists (role: ${existing.role}, active: ${existing.isActive}).`);
    console.log("To reset the password, delete the document in MongoDB and re-run this script.");
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await AdminUser.create({ email: EMAIL, passwordHash, role: ROLE, name: NAME });

  console.log("\n✓ Admin user created successfully");
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Role:     ${ROLE}`);
  console.log(`  Password: ${password}`);
  console.log("\nSave this password — it will NOT be shown again.\n");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
