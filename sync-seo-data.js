// Seeds the SEO Ops Mongo collections from the CSV/JSON artifacts produced by
// Phases 1-3 (technohana-frontend-master/backlink-strategy/). Mirrors the
// sync-prices convention: assumes the frontend repo is checked out as a
// sibling directory unless BACKLINK_STRATEGY_DIR overrides it. Idempotent —
// upserts by a natural sourceKey so re-running never duplicates rows.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";

import SeoOpportunity from "./src/models/seoOpportunity.model.js";
import SeoContact from "./src/models/seoContact.model.js";
import SeoCampaign from "./src/models/seoCampaign.model.js";
import SeoMonitoring from "./src/models/seoMonitoring.model.js";
import SeoReport from "./src/models/seoReport.model.js";

dotenv.config();

const BACKLINK_DIR =
  process.env.BACKLINK_STRATEGY_DIR ||
  path.resolve("../technohana-frontend-master/backlink-strategy");

// --- minimal RFC4180-ish CSV parser (handles quoted fields, embedded commas/quotes) ---
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
    return obj;
  });
}

function readCsv(relPath) {
  const full = path.join(BACKLINK_DIR, relPath);
  if (!fs.existsSync(full)) {
    console.warn(`skip (not found): ${relPath}`);
    return [];
  }
  return parseCsv(fs.readFileSync(full, "utf8"));
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};
const emptyToUndefined = (v) => (v === "" ? undefined : v);

async function syncPriorityOpportunities() {
  let count = 0;
  for (const [file, priorityFallback] of [
    ["opportunities/high-priority.csv", "High"],
    ["opportunities/medium-priority.csv", "Medium"],
    ["opportunities/low-priority.csv", "Low"],
  ]) {
    const rows = readCsv(file);
    for (const r of rows) {
      const sourceKey = `priority-opportunity:${file}:${r["Competitor"]}|${r["Referring Domain"]}|${r["Opportunity Type"]}`;
      await SeoOpportunity.updateOne(
        { sourceKey },
        {
          $setOnInsert: { sourceKey, recordType: "priority-opportunity", status: "new" },
          $set: {
            competitor: r["Competitor"],
            referringDomain: r["Referring Domain"],
            opportunityType: r["Opportunity Type"],
            industryRelevance: r["Industry Relevance"],
            editorialQuality: r["Editorial Quality"],
            likelihoodOfAcceptance: r["Likelihood of Acceptance"],
            trafficQuality: r["Traffic Quality"],
            spamRisk: r["Spam Risk"],
            estimatedAuthority: r["Authority Estimate"],
            relationshipOpportunity: r["Relationship Opportunity"],
            contentOpportunity: r["Content Opportunity"],
            priority: r["Overall Priority"] || priorityFallback,
            confidence: r["Confidence"],
            evidenceLevel: r["Evidence Level"],
            rationale: r["Rationale"],
          },
        },
        { upsert: true }
      );
      count++;
    }
  }
  console.log(`seo_opportunities (priority-opportunity): synced ${count} rows`);
}

async function syncCompetitorGap() {
  const rows =
    readCsv("competitors/competitor-opportunity-gap-scored.csv").length > 0
      ? readCsv("competitors/competitor-opportunity-gap-scored.csv")
      : readCsv("competitors/competitor-opportunity-gap.csv");
  let count = 0;
  for (const r of rows) {
    const sourceKey = `competitor-gap:${r["Competitor"]}|${r["Referring Domain"]}|${r["Opportunity Type"]}`;
    await SeoOpportunity.updateOne(
      { sourceKey },
      {
        $setOnInsert: { sourceKey, recordType: "competitor-gap", status: "new" },
        $set: {
          competitor: r["Competitor"],
          referringDomain: r["Referring Domain"],
          opportunityType: r["Opportunity Type"],
          industry: r["Industry"],
          estimatedAuthority: r["Estimated Authority"],
          estimatedMonthlyTraffic: r["Estimated Monthly Traffic"],
          linkContext: r["Link Context"],
          targetPage: r["Target Page"],
          potentialForTechnohana: r["Potential For Technohana"],
          priority: r["Priority"],
          notes: r["Notes"],
          evidenceLevel: r["Evidence Level"],
          evidenceSource: r["Evidence Source"],
          evidenceUrl: r["Evidence URL"],
          evidenceNotes: r["Evidence Notes"],
          confidence: r["Confidence"],
          contentYear: num(r["Content Year"]),
          overallScore: num(r["Overall Score"]),
        },
      },
      { upsert: true }
    );
    count++;
  }
  console.log(`seo_opportunities (competitor-gap): synced ${count} rows`);
}

async function syncResourcePages() {
  const rows = readCsv("resource-pages.csv");
  let count = 0;
  for (const r of rows) {
    const sourceKey = `resource-page:${r["Resource Page URL"]}`;
    await SeoOpportunity.updateOne(
      { sourceKey },
      {
        $setOnInsert: { sourceKey, recordType: "resource-page", status: "new" },
        $set: {
          organizationType: r["Organization Type"],
          organizationName: r["Organization Name"],
          resourcePageUrl: r["Resource Page URL"],
          topicFocus: r["Topic Focus"],
          evidenceLevel: r["Evidence Level"],
          confidence: r["Confidence"],
          contentYear: num(r["Content Year"]),
          approvalProbability: r["Approval Probability"],
          notes: r["Notes"],
        },
      },
      { upsert: true }
    );
    count++;
  }
  console.log(`seo_opportunities (resource-page): synced ${count} rows`);
}

async function syncContacts() {
  const contacts = readCsv("outreach/contacts.csv");
  const followups = readCsv("outreach/followups.csv");
  const responses = readCsv("outreach/responses.csv");
  let count = 0;
  for (const r of contacts) {
    const sourceKey = `contact:${r["Email"] || r["Company"] || r["Contact Name"]}`;
    const contactFollowups = followups
      .filter((f) => f["Website"] === r["Website"] || f["Website"] === r["Company"])
      .map((f) => ({
        followUpNumber: num(f["Follow-up Number"]),
        scheduledDate: f["Scheduled Date"] ? new Date(f["Scheduled Date"]) : undefined,
        completed: /^(true|yes|1)$/i.test(f["Completed"] || ""),
        notes: f["Notes"],
      }));
    const contactResponses = responses
      .filter((res) => res["Website"] === r["Website"] || res["Website"] === r["Company"])
      .map((res) => ({
        response: res["Response"],
        decision: res["Decision"],
        liveLink: res["Live Link"],
        notes: res["Notes"],
      }));
    await SeoContact.updateOne(
      { sourceKey },
      {
        $setOnInsert: { sourceKey, status: "new" },
        $set: {
          contactName: r["Contact Name"],
          company: r["Company"],
          website: r["Website"],
          email: r["Email"],
          role: r["Role"],
          opportunityType: r["Opportunity Type"],
          status: emptyToUndefined((r["Status"] || "").toLowerCase().replace(/\s+/g, "-")),
          lastContact: r["Last Contact"] ? new Date(r["Last Contact"]) : undefined,
          nextFollowUp: r["Next Follow-up"] ? new Date(r["Next Follow-up"]) : undefined,
          owner: r["Owner"],
          notes: r["Notes"],
          followUps: contactFollowups,
          responses: contactResponses,
        },
      },
      { upsert: true }
    );
    count++;
  }
  console.log(`seo_contacts: synced ${count} rows`);
}

async function syncCampaigns() {
  const rows = readCsv("outreach/campaigns.csv");
  let count = 0;
  for (const r of rows) {
    const sourceKey = `campaign:${r["Campaign"]}`;
    await SeoCampaign.updateOne(
      { sourceKey },
      {
        $setOnInsert: { sourceKey },
        $set: {
          campaign: r["Campaign"],
          targetAudience: r["Target Audience"],
          startDate: r["Start Date"] ? new Date(r["Start Date"]) : undefined,
          endDate: r["End Date"] ? new Date(r["End Date"]) : undefined,
          status: emptyToUndefined((r["Status"] || "").toLowerCase()),
          objective: r["Objective"],
        },
      },
      { upsert: true }
    );
    count++;
  }
  console.log(`seo_campaigns: synced ${count} rows`);
}

async function syncMonitoring() {
  let count = 0;
  const files = [
    ["monitoring/live-backlinks.csv", "live"],
    ["monitoring/lost-backlinks.csv", "lost"],
    ["monitoring/broken-links.csv", "broken"],
  ];
  for (const [file, linkStatus] of files) {
    const rows = readCsv(file);
    for (const r of rows) {
      const sourceKey = `monitoring:${linkStatus}:${r["Website"]}|${r["Live URL"]}`;
      await SeoMonitoring.updateOne(
        { sourceKey },
        {
          $setOnInsert: { sourceKey },
          $set: {
            website: r["Website"],
            targetPage: r["Target Page"],
            liveUrl: r["Live URL"],
            anchor: r["Anchor"],
            follow: r["Follow"],
            lastChecked: r["Last Checked"] ? new Date(r["Last Checked"]) : undefined,
            notes: r["Notes"],
            linkStatus,
          },
        },
        { upsert: true }
      );
      count++;
    }
  }

  const published = readCsv("outreach/published-links.csv");
  for (const r of published) {
    const sourceKey = `monitoring:published:${r["Website"]}|${r["Live URL"]}`;
    await SeoMonitoring.updateOne(
      { sourceKey },
      {
        $setOnInsert: { sourceKey },
        $set: {
          website: r["Website"],
          targetPage: r["Target Page"],
          liveUrl: r["Live URL"],
          anchorText: r["Anchor Text"],
          linkType: r["Link Type"],
          publishedDate: r["Published Date"] ? new Date(r["Published Date"]) : undefined,
          linkStatus: emptyToUndefined((r["Status"] || "").toLowerCase()) || "published",
        },
      },
      { upsert: true }
    );
    count++;
  }
  console.log(`seo_monitoring: synced ${count} rows`);
}

async function syncReports() {
  const indexPath = path.join(BACKLINK_DIR, "reports/index.json");
  let count = 0;
  if (fs.existsSync(indexPath)) {
    const entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    for (const entry of entries) {
      await SeoReport.updateOne(
        { file: entry.file },
        {
          $set: {
            title: entry.title,
            type: "monthly",
            period: entry.date?.slice(0, 7),
            date: entry.date ? new Date(entry.date) : undefined,
          },
        },
        { upsert: true }
      );
      count++;
    }
  }

  // Ad-hoc weekly snapshot reports at the folder root: weekly_report_*.md
  if (fs.existsSync(BACKLINK_DIR)) {
    for (const name of fs.readdirSync(BACKLINK_DIR)) {
      if (/^weekly_report_.*\.md$/.test(name)) {
        await SeoReport.updateOne(
          { file: name },
          {
            $set: {
              title: name.replace(/[_\-]/g, " ").replace(/\.md$/, ""),
              type: "weekly",
            },
          },
          { upsert: true }
        );
        count++;
      }
    }
  }
  console.log(`seo_reports: synced ${count} rows`);
}

async function main() {
  if (!fs.existsSync(BACKLINK_DIR)) {
    console.error(`backlink-strategy folder not found at ${BACKLINK_DIR}. Set BACKLINK_STRATEGY_DIR to override.`);
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_DB);
  console.log(`Connected. Syncing from ${BACKLINK_DIR}`);

  await syncPriorityOpportunities();
  await syncCompetitorGap();
  await syncResourcePages();
  await syncContacts();
  await syncCampaigns();
  await syncMonitoring();
  await syncReports();

  console.log("SEO Ops data sync complete.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("sync-seo-data failed:", err);
  process.exit(1);
});
