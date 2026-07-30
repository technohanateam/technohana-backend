import SeoOpportunity from "../models/seoOpportunity.model.js";
import SeoMonitoring from "../models/seoMonitoring.model.js";

export function normalizeDomain(value) {
  if (!value) return "";
  return String(value)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .trim()
    .toLowerCase();
}

// Cross-references a competitor's backlink CSV export against domains that
// already link to Technohana (SeoMonitoring, live/published) to find genuine
// gaps — domains linking to the competitor but not to us — and upserts them
// as competitor-gap SeoOpportunity records. Never creates or modifies a link.
export async function importCompetitorBacklinkCsv({ rows, competitorName }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows must be a non-empty array");
  }
  if (!competitorName || !competitorName.trim()) {
    throw new Error("competitorName is required");
  }

  const ownDomains = await SeoMonitoring.find({ linkStatus: { $in: ["live", "published"] } }).distinct("website");
  const ownSet = new Set(ownDomains.map(normalizeDomain).filter(Boolean));

  const summary = { imported: 0, skippedOwn: 0, skippedExisting: 0, gapsFound: 0 };

  for (const row of rows) {
    const domain = normalizeDomain(row.referringDomain || row.domain);
    if (!domain) continue;

    if (ownSet.has(domain)) {
      summary.skippedOwn += 1;
      continue;
    }

    const sourceKey = `competitor-gap:${competitorName}:${domain}`;
    const existing = await SeoOpportunity.findOne({ sourceKey }).lean();
    if (existing) {
      summary.skippedExisting += 1;
      continue;
    }

    await SeoOpportunity.create({
      recordType: "competitor-gap",
      competitor: competitorName,
      referringDomain: domain,
      opportunityType: row.linkType || row.opportunityType,
      linkContext: row.anchorText || row.anchor,
      discoverySource: "csv-import",
      status: "new",
      sourceKey,
    });
    summary.imported += 1;
    summary.gapsFound += 1;
  }

  return summary;
}
