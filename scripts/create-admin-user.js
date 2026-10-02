import "dotenv/config";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import AdminUser from "../src/models/adminUser.model.js";

// Usage (from technohana-backend-master/):
//   node scripts/create-admin-user.js abdul@technohana.in "Abdul Salam"            # dry run
//   node scripts/create-admin-user.js abdul@technohana.in "Abdul Salam" --apply    # writes to MONGO_DB
// Password: set NEW_ADMIN_PASSWORD, otherwise a random one is generated and printed once.
// "Super admin" for the admin panel = role "admin" (every page) + crmRole "admin" (full CRM).
// Do NOT use crmRole "super_admin": authenticateAdmin treats that as CRM-only and blocks /admin/*.
const [email, name = "Admin"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");

const run = async () => {
  if (!email) throw new Error("Email is required.");
  const normalizedEmail = email.toLowerCase().trim();
  const password = process.env.NEW_ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  await mongoose.connect(process.env.MONGO_DB);
  const existing = await AdminUser.findOne({ email: normalizedEmail });
  console.log(`${APPLY ? "" : "[dry-run] "}${existing ? "Update" : "Create"} ${normalizedEmail} -> role=admin, crmRole=admin, active`);

  if (APPLY) {
    const passwordHash = await bcrypt.hash(password, 10);
    if (existing) {
      Object.assign(existing, { role: "admin", crmRole: "admin", active: true, extraPages: [], revokedPages: [] });
      if (process.env.NEW_ADMIN_PASSWORD) existing.passwordHash = passwordHash;
      await existing.save();
    } else {
      await AdminUser.create({ email: normalizedEmail, name, passwordHash, role: "admin", crmRole: "admin" });
    }
    if (!existing || process.env.NEW_ADMIN_PASSWORD) {
      console.log(process.env.NEW_ADMIN_PASSWORD ? "Password set from NEW_ADMIN_PASSWORD." : `Generated password (shown once): ${password}`);
    }
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
