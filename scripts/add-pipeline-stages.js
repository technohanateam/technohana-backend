// Adds the master-plan stages and canonical aliases to the CRM pipelines. Additive only: it never
// renames, reorders or removes a stage, and never touches a deal. It does add any planned stage
// that is missing, so re-running after an admin deleted a planned stage will add it back.
// See docs/TECHNOHANA_PIPELINE_STAGE_MAPPING.md.
//
//   node scripts/add-pipeline-stages.js            # DRY RUN: read-only report of current stages,
//                                                  # open deals per stage, and what would change
//   node scripts/add-pipeline-stages.js --apply
//
// The dry run writes nothing, so it is also the safe way to see what a database currently holds.
// Take a mongodump before --apply. Rollback: remove the added stage keys (the pipeline API refuses
// while deals sit in a stage) and $unset the alias fields.
import "dotenv/config";
import mongoose from "mongoose";
import CRMPipeline from "../src/models/crm/crmPipeline.model.js";
import CRMDeal from "../src/models/crm/crmDeal.model.js";
import { planStageChanges } from "../src/constants/pipelineStageMap.js";

const APPLY = process.argv.includes("--apply");

const openCounts = async (pipelineId) => {
  const rows = await CRMDeal.aggregate([
    { $match: { pipeline: pipelineId, isDeleted: false } },
    { $group: { _id: "$stageKey", count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
};

const run = async () => {
  // A dry run must not write anything: Mongoose would otherwise create collections and build missing indexes on connect.
  await mongoose.connect(`${process.env.MONGO_DB}`, { autoIndex: APPLY, autoCreate: APPLY });
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} on db "${mongoose.connection.name}"`);

  const pipelines = await CRMPipeline.find({});
  for (const p of pipelines) {
    const before = p.stages.map((s) => s.toObject());
    const counts = await openCounts(p._id);
    console.log(`\n${p.name} (${p.type}${p.isActive ? "" : ", inactive"})`);
    for (const s of before.slice().sort((a, b) => a.order - b.order)) {
      console.log(`  ${String(s.order).padStart(5)}  ${s.key.padEnd(22)} ${s.label.padEnd(24)} deals:${counts[s.key] || 0}${s.isWon ? " [won]" : ""}${s.isLost ? " [lost]" : ""}${s.alias ? ` alias=${s.alias}` : ""}`);
    }
    const orphaned = Object.keys(counts).filter((k) => !before.some((s) => s.key === k));
    if (orphaned.length) console.log(`  WARNING: deals sit in stage keys the pipeline does not define: ${orphaned.join(", ")}`);

    const plan = planStageChanges(before, p.type);
    if (plan.skipped) { console.log("  no plan for this pipeline type; skipped"); continue; }
    console.log(`  would add: ${plan.addedKeys.join(", ") || "(none)"}`);
    console.log(`  would alias: ${plan.aliasedKeys.join(", ") || "(none)"}`);
    if (!APPLY || (!plan.addedKeys.length && !plan.aliasedKeys.length)) continue;

    p.stages = plan.stages;
    await p.save();
    const after = await openCounts(p._id);
    const same = JSON.stringify(Object.entries(counts).sort()) === JSON.stringify(Object.entries(after).sort());
    console.log(`  applied. Deal counts per stage ${same ? "unchanged" : "CHANGED (unexpected)"}`);
    if (!same) process.exitCode = 2;
  }
  await mongoose.disconnect();
};

// Explicit exit: modules imported by the models can leave timers open that would keep the process alive.
run().then(() => process.exit(process.exitCode || 0)).catch((err) => { console.error(err); process.exit(1); });
