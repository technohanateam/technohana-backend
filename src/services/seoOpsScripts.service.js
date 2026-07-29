import SeoOpportunity from "../models/seoOpportunity.model.js";
import SeoContact from "../models/seoContact.model.js";
import SeoCampaign from "../models/seoCampaign.model.js";
import SeoMonitoring from "../models/seoMonitoring.model.js";
import SeoReport from "../models/seoReport.model.js";

// Node/Mongo port of backlink-strategy/scripts/*.py — those scripts only ran
// against local CSV files (dev/local checkouts), so this operates on the
// already-synced SeoOpportunity/SeoContact/SeoCampaign/SeoMonitoring
// collections instead, giving the same checks in every environment.

const REQUIRED_FIELD_BY_MODEL = [
  { label: "SeoOpportunity", Model: SeoOpportunity, field: (doc) => doc.referringDomain || doc.organizationName },
  { label: "SeoContact", Model: SeoContact, field: (doc) => doc.website || doc.company },
  { label: "SeoCampaign", Model: SeoCampaign, field: (doc) => doc.campaign },
  { label: "SeoMonitoring", Model: SeoMonitoring, field: (doc) => doc.website },
];

export const validateOpportunityData = async () => {
  const lines = [];
  let ok = true;

  for (const { label, Model, field } of REQUIRED_FIELD_BY_MODEL) {
    const docs = await Model.find({}).lean();
    lines.push(label);
    if (docs.length === 0) {
      lines.push("  [OK] 0 record(s)");
      continue;
    }

    const missingRequired = docs.filter((d) => !String(field(d) || "").trim()).map((d) => d._id.toString());
    const missingSourceKey = docs.filter((d) => !d.sourceKey).map((d) => d._id.toString());

    if (missingRequired.length) {
      ok = false;
      lines.push(`  [FAIL] missing required identifying field on record(s): ${missingRequired.join(", ")}`);
    }
    if (missingSourceKey.length) {
      ok = false;
      lines.push(`  [FAIL] missing sourceKey on record(s): ${missingSourceKey.join(", ")}`);
    }
    if (!missingRequired.length && !missingSourceKey.length) {
      lines.push(`  [OK] ${docs.length} record(s)`);
    }
  }

  lines.push("");
  lines.push(ok ? "All records valid." : "Validation failed — see [FAIL] lines above.");
  return { ok, stdout: lines.join("\n") };
};

export const checkDuplicateOpportunities = async () => {
  const docs = await SeoOpportunity.find({}).lean();
  const seen = new Map();
  const duplicates = [];

  for (const doc of docs) {
    const domain = doc.referringDomain || doc.organizationName || "";
    const url = doc.resourcePageUrl || doc.targetPage || "";
    const type = doc.opportunityType || doc.organizationType || "";
    const key = `${domain}|${url}|${type}`.trim().toLowerCase();
    if (key === "||") continue;

    if (seen.has(key)) {
      duplicates.push({ key, ids: [seen.get(key), doc._id.toString()] });
    } else {
      seen.set(key, doc._id.toString());
    }
  }

  const lines = [];
  if (duplicates.length) {
    lines.push(`${duplicates.length} duplicate group(s) found (Domain + Opportunity URL + Opportunity Type):`);
    for (const dup of duplicates) {
      lines.push(`  ${dup.key} -> ${dup.ids.join(", ")}`);
    }
  } else {
    lines.push("No duplicates found across seo_opportunities.");
  }

  return { ok: duplicates.length === 0, stdout: lines.join("\n") };
};

const RELEVANCE_MAP = { "very high": 10, high: 8, medium: 6, low: 3, "very low": 0 };
const EVIDENCE_MAP = { verified: 10, observed: 6, potential: 3 };
const PRIORITY_MAP = { "very high": 10, high: 8, medium: 5, low: 2 };
const RELATIONSHIP_KEYWORDS = ["partnership", "vendor", "association", "chapter"];
const CONTENT_KEYWORDS = ["guest post", "resource page", "editorial", "case study"];
const LISTING_KEYWORDS = ["directory", "listing"];

const mappedScore = (value, mapping) => mapping[String(value || "").trim().toLowerCase()] ?? 0;

const authorityScore = (value) => {
  const match = String(value || "").match(/\d+/);
  if (!match) return { score: 0, unscored: true };
  return { score: Math.min(10, Math.round(Number(match[0]) / 10)), unscored: false };
};

const relationshipScore = (opportunityType) => {
  const lowered = String(opportunityType || "").toLowerCase();
  if (RELATIONSHIP_KEYWORDS.some((k) => lowered.includes(k))) return 8;
  if (LISTING_KEYWORDS.some((k) => lowered.includes(k))) return 5;
  return 2;
};

const contentScore = (opportunityType) => {
  const lowered = String(opportunityType || "").toLowerCase();
  return CONTENT_KEYWORDS.some((k) => lowered.includes(k)) ? 8 : 3;
};

const freshnessScore = (contentYear, currentYear) => {
  if (!contentYear) return 5;
  const age = currentYear - contentYear;
  if (age <= 0) return 10;
  if (age === 1) return 8;
  if (age === 2) return 6;
  if (age === 3) return 4;
  return 2;
};

export const recomputeOpportunityScores = async () => {
  const currentYear = new Date().getFullYear();
  const docs = await SeoOpportunity.find({ recordType: "competitor-gap" }).lean();

  if (!docs.length) {
    return { ok: true, stdout: "No competitor-gap opportunities to score." };
  }

  let unscoredCount = 0;
  const operations = docs.map((doc) => {
    const relevance = mappedScore(doc.potentialForTechnohana, RELEVANCE_MAP);
    const editorialQuality = mappedScore(doc.evidenceLevel, EVIDENCE_MAP);
    const acceptanceProbability = mappedScore(doc.priority, PRIORITY_MAP);
    const { score: authority, unscored } = authorityScore(doc.estimatedAuthority);
    const relationship = relationshipScore(doc.opportunityType);
    const content = contentScore(doc.opportunityType);
    const freshness = freshnessScore(doc.contentYear, currentYear);

    const overallScore =
      (relevance * 0.3 +
        editorialQuality * 0.2 +
        acceptanceProbability * 0.15 +
        authority * 0.1 +
        relationship * 0.1 +
        content * 0.1 +
        freshness * 0.05) *
      10;

    if (unscored) unscoredCount += 1;

    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { overallScore: Math.round(overallScore * 10) / 10, authorityUnscored: unscored } },
      },
    };
  });

  await SeoOpportunity.bulkWrite(operations);

  const stdout = [
    `Scored ${docs.length} row(s)`,
    `${unscoredCount} row(s) had no numeric Estimated Authority (scored 0 for that factor, not fabricated)`,
  ].join("\n");
  return { ok: true, stdout };
};

const formatList = (items, emptyMessage) => {
  if (!items.length) return `_${emptyMessage}_`;
  return items.map((item) => `- ${item}`).join("\n");
};

export const generateMonthlyReport = async () => {
  const today = new Date();
  const period = today.toISOString().slice(0, 7); // YYYY-MM
  const monthYear = today.toLocaleString("en-US", { month: "long", year: "numeric" });

  const [newOpportunities, publishedLinks, pendingOutreach, topPriorities] = await Promise.all([
    SeoOpportunity.countDocuments({ recordType: "priority-opportunity" }),
    SeoMonitoring.find({ linkStatus: { $in: ["live", "published"] } }).lean(),
    SeoContact.countDocuments({ status: { $in: ["new", "contacted", "follow-up"] } }),
    SeoOpportunity.find({ recordType: "priority-opportunity", priority: "High" })
      .sort({ overallScore: -1 })
      .limit(10)
      .lean(),
  ]);

  const publishedList = formatList(
    publishedLinks.map((l) => l.website || "Unknown"),
    "None published yet"
  );
  const topPrioritiesList = formatList(
    topPriorities.map((o) => o.referringDomain || "Unknown"),
    "None recorded"
  );

  const content = [
    `# Monthly SEO Report — ${monthYear}`,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| New Opportunities Logged | ${newOpportunities} |`,
    `| Published Links | ${publishedLinks.length} |`,
    `| Pending Outreach | ${pendingOutreach} |`,
    "",
    "## Published Links",
    publishedList,
    "",
    "## Top Priority Opportunities",
    topPrioritiesList,
    "",
  ].join("\n");

  const filename = `monthly-report-${period}.md`;
  const report = await SeoReport.findOneAndUpdate(
    { type: "monthly", period },
    {
      $set: {
        title: `Monthly SEO Report — ${monthYear}`,
        type: "monthly",
        period,
        file: filename,
        content,
        date: today,
      },
    },
    { upsert: true, new: true }
  );

  const stdout = [`Report written: ${filename}`, `Report record: ${report._id}`].join("\n");
  return { ok: true, stdout };
};
