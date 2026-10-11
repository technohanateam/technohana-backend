// Pulls leads from Meta Lead Ads forms into the CRM — for leads submitted before
// the webhook was connected, or during an outage. Safe to re-run: leads already in
// the CRM (same leadgen id, email or phone) are skipped.
//
//   node scripts/backfill-meta-leads.js --form <formId> [--form <formId> …] [--since 2026-09-01] [--apply]
//
// Without --apply it only lists what it would import.
import "dotenv/config";
import mongoose from "mongoose";
import { graphGet, LEAD_FIELDS, processMetaLead, mapMetaLead } from "../src/services/metaLeadAds.js";
import CRMActivity from "../src/models/crm/crmActivity.model.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const forms = args.flatMap((a, i) => (a === "--form" && args[i + 1] ? [args[i + 1]] : []));
const sinceArg = args[args.indexOf("--since") + 1];
const since = args.includes("--since") ? Math.floor(new Date(`${sinceArg}T00:00:00+05:30`).getTime() / 1000) : null;

if (!forms.length || (args.includes("--since") && !Number.isFinite(since))) {
  console.error("Usage: node scripts/backfill-meta-leads.js --form <formId> [--since YYYY-MM-DD] [--apply]");
  process.exit(1);
}

const run = async () => {
  await mongoose.connect(process.env.MONGO_DB);
  const totals = { seen: 0, created: 0, matched: 0, skipped: 0 };

  for (const formId of forms) {
    const params = { fields: LEAD_FIELDS, limit: "100" };
    if (since) params.filtering = JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]);
    let page = await graphGet(`${encodeURIComponent(formId)}/leads`, params);

    for (;;) {
      for (const raw of page.data || []) {
        totals.seen++;
        if (await CRMActivity.exists({ "metadata.leadgenId": String(raw.id) })) { totals.skipped++; continue; }
        if (!APPLY) {
          const { fields } = mapMetaLead(raw);
          console.log(`[dry-run] ${raw.id} ${fields.name} <${fields.email || fields.phone || "no contact"}> · ${raw.created_time}`);
          continue;
        }
        const result = await processMetaLead({ ...raw, form_id: raw.form_id || formId });
        if (result.created) totals.created++;
        else if (result.duplicate) totals.skipped++;
        else totals.matched++;
      }
      const next = page.paging?.cursors?.after && page.paging?.next;
      if (!next) break;
      page = await graphGet(`${encodeURIComponent(formId)}/leads`, { ...params, after: page.paging.cursors.after });
    }
  }

  console.log(`${APPLY ? "" : "[dry-run] "}seen ${totals.seen} · created ${totals.created} · matched existing ${totals.matched} · already imported ${totals.skipped}`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
