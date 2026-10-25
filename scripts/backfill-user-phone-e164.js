import "dotenv/config";
import mongoose from "mongoose";
import { User } from "../src/models/user.model.js";
import { normalizePhone } from "../src/utils/phone.js";

const DRY_RUN = !process.argv.includes("--apply");

const run = async () => {
  await mongoose.connect(process.env.MONGO_DB);

  const users = await User.find({ phone: { $exists: true, $ne: "" }, phoneE164: { $exists: false } })
    .select("phone")
    .lean();

  const updates = users
    .map((u) => ({ _id: u._id, phone: u.phone, phoneE164: normalizePhone(u.phone) }))
    .filter((u) => u.phoneE164);

  console.table(updates.slice(0, 20));
  console.log(`${updates.length} of ${users.length} user(s) would get a phoneE164 (rest have unusable numbers).`);

  if (DRY_RUN) {
    console.log("Dry run only — pass --apply to write changes.");
  } else {
    if (updates.length) {
      await User.bulkWrite(
        updates.map((u) => ({ updateOne: { filter: { _id: u._id }, update: { $set: { phoneE164: u.phoneE164 } } } }))
      );
    }
    console.log(`Applied ${updates.length} update(s).`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
