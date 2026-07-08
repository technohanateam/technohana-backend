import dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import connectDb from "./src/config/db.js";
import AdminUser from "./src/models/adminUser.model.js";

const arg = (name) => {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
};

const email    = arg("email")    || "admin@technohana.in";
const password = arg("password") || "Admin@1234";
const name     = arg("name")     || "Admin";

async function main() {
  await connectDb();

  const normalizedEmail = email.toLowerCase().trim();
  const passwordHash    = await bcrypt.hash(password, 10);

  const existing = await AdminUser.findOne({ email: normalizedEmail });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.name         = name;
    existing.active       = true;
    await existing.save();
    console.log(`Admin user updated: ${normalizedEmail}`);
  } else {
    await AdminUser.create({
      email: normalizedEmail,
      name,
      passwordHash,
      role: "admin",
    });
    console.log(`Admin user created: ${normalizedEmail}`);
  }

  console.log(`  Email:    ${normalizedEmail}`);
  console.log(`  Password: ${password}  <- change this after first login`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
