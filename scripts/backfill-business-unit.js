// Fills `businessUnit` on existing CRM deals and leads from their pipeline type, and on orders
// that predate the field. Only touches records where it is currently empty, so it is safe to
// re-run. Records whose pipeline type is unknown stay empty ("Unassigned").
//
//   node scripts/backfill-business-unit.js            # dry run, prints counts only
//   node scripts/backfill-business-unit.js --apply
//
// Take a mongodump first. Rollback: db.<collection>.updateMany({}, { $unset: { businessUnit: "" } })
import "dotenv/config";
import mongoose from "mongoose";
import CRMPipeline from "../src/models/crm/crmPipeline.model.js";
import CRMDeal from "../src/models/crm/crmDeal.model.js";
import CRMLead from "../src/models/crm/crmLead.model.js";
import { Order } from "../src/models/order.model.js";
import { businessUnitForPipelineType } from "../src/constants/businessUnit.js";

const APPLY = process.argv.includes("--apply");
const EMPTY = null; // matches both null and missing fields

const run = async () => {
  // A dry run must not write anything: Mongoose would otherwise create collections and build missing indexes on connect.
  await mongoose.connect(`${process.env.MONGO_DB}`, { autoIndex: APPLY, autoCreate: APPLY });
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} on db "${mongoose.connection.name}"`);

  const pipelines = await CRMPipeline.find({}, "type").lean();
  const byUnit = {};
  for (const p of pipelines) {
    const unit = businessUnitForPipelineType(p.type);
    if (unit) (byUnit[unit] ||= []).push(p._id);
  }

  for (const [label, Model, field] of [["deals", CRMDeal, "pipeline"], ["leads", CRMLead, "pipeline"]]) {
    for (const [unit, ids] of Object.entries(byUnit)) {
      const filter = { [field]: { $in: ids }, businessUnit: EMPTY };
      const n = await Model.countDocuments(filter);
      if (APPLY && n) await Model.updateMany(filter, { $set: { businessUnit: unit } });
      console.log(`${label} -> ${unit}: ${n}`);
    }
    console.log(`${label} left unassigned: ${await Model.countDocuments({ businessUnit: EMPTY })}`);
  }

  const orderFilter = { businessUnit: EMPTY };
  const orders = await Order.countDocuments(orderFilter);
  if (APPLY && orders) await Order.updateMany(orderFilter, { $set: { businessUnit: "b2c" } });
  console.log(`orders -> b2c: ${orders}`);

  await mongoose.disconnect();
};

// Explicit exit: modules imported by the models can leave timers open that would keep the process alive.
run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
