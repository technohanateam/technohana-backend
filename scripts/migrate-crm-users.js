import "dotenv/config";
import mongoose from "mongoose";
import AdminUser from "../src/models/adminUser.model.js";
import CrmUser from "../src/models/crmUser.model.js";
import CRMLead from "../src/models/crm/crmLead.model.js";

const DRY_RUN = !process.argv.includes("--apply");
const SITE_SOURCES = ["website", "enquiry_form", "chat"];

const run = async () => {
  await mongoose.connect(process.env.MONGO_DB);

  // Accounts with CRM access keep their _id so existing assignedTo/createdBy refs stay valid.
  const admins = await AdminUser.find({ $or: [{ crmRole: { $exists: true, $ne: null } }, { role: "sales" }] }).lean();
  let copied = 0;
  for (const a of admins) {
    if (await CrmUser.exists({ _id: a._id })) continue;
    console.log(`${DRY_RUN ? "[dry-run] " : ""}CrmUser <- ${a.email} (${a.crmRole || "sales"})`);
    if (!DRY_RUN) {
      // Same passwordHash: they keep their password, but tokens/sessions are separate.
      await CrmUser.create({
        _id: a._id,
        email: a.email,
        name: a.name,
        passwordHash: a.passwordHash,
        crmRole: a.crmRole || "sales",
        active: a.active,
      });
    }
    copied++;
  }

  const siteFilter = { isDeleted: false, $or: [{ source: { $in: SITE_SOURCES } }, { enquiryRef: { $ne: null } }] };
  const siteLeads = await CRMLead.countDocuments(siteFilter);
  console.log(`${DRY_RUN ? "[dry-run] " : ""}Archiving ${siteLeads} site-sourced leads (isDeleted=true)`);
  if (!DRY_RUN && siteLeads) {
    await CRMLead.updateMany(siteFilter, { $set: { isDeleted: true, deletedAt: new Date(), archivedReason: "site_sourced" } });
  }

  console.log(`Done. ${copied} CRM users copied. ${DRY_RUN ? "Re-run with --apply to write changes." : ""}`);
  await mongoose.disconnect();
};

run().catch((err) => { console.error(err); process.exit(1); });
