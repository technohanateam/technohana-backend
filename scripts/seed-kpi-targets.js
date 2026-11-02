// Seeds the 90-day transformation PLAN targets (January 2027 base case) so admins can edit them.
// These are planning targets, not performance data: every row is stored with isPlan=true.
// Only targets with a live data source are seeded. Discovery meetings, proposals sent, PoCs
// and similar need pipeline/project records that don't exist yet.
//
//   node scripts/seed-kpi-targets.js --owner <crm user email>            # dry run
//   node scripts/seed-kpi-targets.js --owner <crm user email> --apply
//
// Re-runnable: existing rows for the same period/unit/metric are left untouched.
import "dotenv/config";
import mongoose from "mongoose";
import KpiTarget from "../src/models/crm/kpiTarget.model.js";
import CrmUser from "../src/models/crmUser.model.js";
import { toMinor } from "../src/utils/money.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ownerEmail = args.includes("--owner") ? args[args.indexOf("--owner") + 1]?.toLowerCase() : undefined;
const PERIOD = "2027-01";
const lakh = (n) => toMinor(n * 100000, "INR");

const PLAN = [
  { label: "Total monthly revenue", metric: "revenue_combined", businessUnit: null, target: lakh(25), unit: "money" },
  { label: "B2C Learning revenue", metric: "revenue_combined", businessUnit: "b2c", target: lakh(5), unit: "money" },
  { label: "B2B Enterprise revenue", metric: "revenue_combined", businessUnit: "b2b", target: lakh(14), unit: "money" },
  { label: "AI Engineering revenue", metric: "revenue_combined", businessUnit: "ai", target: lakh(6), unit: "money" },
  { label: "B2C qualified leads (plan: 100-150, floor)", metric: "leads_qualified", businessUnit: "b2c", target: 100, unit: "count" },
  { label: "B2C paid enrolments (plan: 15-25, floor)", metric: "enrolments", businessUnit: "b2c", target: 15, unit: "count" },
  { label: "B2C lead-to-win conversion (plan: 15-20%, floor)", metric: "conversion_rate", businessUnit: "b2c", target: 15, unit: "percent" },
];

const run = async () => {
  // A dry run must not write anything: Mongoose would otherwise create collections and build missing indexes on connect.
  await mongoose.connect(`${process.env.MONGO_DB}`, { autoIndex: APPLY, autoCreate: APPLY });
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} on db "${mongoose.connection.name}", period ${PERIOD}`);
  const owner = ownerEmail ? await CrmUser.findOne({ email: ownerEmail }).select("_id").lean() : null;
  if (ownerEmail && !owner) throw new Error(`No CRM user with email ${ownerEmail}`);

  for (const row of PLAN) {
    const key = { period: PERIOD, businessUnit: row.businessUnit, metric: row.metric };
    const exists = await KpiTarget.exists(key);
    console.log(`${exists ? "exists " : "create "} ${row.label}`);
    if (APPLY && !exists) await KpiTarget.create({ ...row, period: PERIOD, currency: "INR", isPlan: true, owner: owner?._id, updatedBy: owner?._id });
  }
  await mongoose.disconnect();
};

// Explicit exit: modules imported by the models can leave timers open that would keep the process alive.
run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
