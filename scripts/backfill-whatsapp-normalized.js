import "dotenv/config";
import mongoose from "mongoose";
import CRMLead from "../src/models/crm/crmLead.model.js";
import { normalizePhone } from "../src/utils/phone.js";

// Fills whatsAppNormalized on leads created before the field existed. Dry run unless --apply.
const DRY_RUN = !process.argv.includes("--apply");

const run = async () => {
  await mongoose.connect(process.env.MONGO_DB);

  const leads = await CRMLead.find({ whatsApp: { $exists: true, $ne: "" }, whatsAppNormalized: { $exists: false } })
    .select("whatsApp country")
    .lean();

  const updates = leads
    .map((l) => ({ _id: l._id, whatsApp: l.whatsApp, whatsAppNormalized: normalizePhone(l.whatsApp, l.country) }))
    .filter((l) => l.whatsAppNormalized);

  console.table(updates.slice(0, 20));
  console.log(`${updates.length} of ${leads.length} lead(s) would get a whatsAppNormalized (rest have unusable numbers).`);

  if (DRY_RUN) {
    console.log("Dry run only — pass --apply to write changes.");
  } else if (updates.length) {
    await CRMLead.bulkWrite(
      updates.map((l) => ({ updateOne: { filter: { _id: l._id }, update: { $set: { whatsAppNormalized: l.whatsAppNormalized } } } })),
    );
    console.log(`Applied ${updates.length} update(s).`);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
