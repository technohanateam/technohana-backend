import * as cheerio from "cheerio";
import SeoOpportunity from "../models/seoOpportunity.model.js";
import SeoSettings from "../models/seoSettings.model.js";
import { callClaude, extractJson } from "./aiAgent.service.js";
import { isFetchAllowed } from "../utils/robotsCache.js";
import { throttledFetch } from "../utils/domainRateLimiter.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

const DEFAULT_DISCOVERY_FETCH_SETTINGS = {
  rateLimitMs: 3000,
  userAgent: "TechnohanaBacklinkBot/1.0 (+https://technohana.com/bot)",
  requestTimeoutMs: 10000,
};

// Only these fixed, well-known paths are ever tried — never links discovered
// on the page itself. This keeps discovery bounded and non-crawling.
const CONTACT_PATHS = ["/contact", "/contact-us", "/about", "/about-us"];

async function getDiscoverySettings() {
  const settings = await SeoSettings.findOne().lean();
  return {
    fetch: { ...DEFAULT_DISCOVERY_FETCH_SETTINGS, ...(settings?.backlinkVerification || {}) },
    candidatesPerRun: settings?.discovery?.candidatesPerRun || 15,
  };
}

// Asks Claude to propose real, plausible websites for a category. `callClaudeFn`/
// `extractJsonFn` are injectable for testing without hitting the Anthropic API.
export async function proposeDiscoveryCandidates({ category, count = 10, callClaudeFn = callClaude, extractJsonFn = extractJson }) {
  const system =
    "You are a backlink research assistant for Technohana, an IT/cloud/cybersecurity/agile training " +
    "provider. Propose only real, well-known websites you have genuine knowledge of — never invent " +
    "placeholder or fictional domains. Respond with strict JSON only, no prose, no markdown fences.";
  const prompt =
    `List ${count} real websites in the category "${category}" that could plausibly link to an ` +
    `IT/cloud/cybersecurity/agile training provider (resource pages, directories, associations, ` +
    `guest-post-friendly blogs, university resource pages, conference sites). For each, give: ` +
    `domain (bare hostname, no protocol/path), organizationName, opportunityType ` +
    `(e.g. "resource page", "directory", "association", "guest post blog"), rationale (one sentence). ` +
    `Return a JSON array of objects with exactly those four keys.`;

  const text = await callClaudeFn({ system, prompt, maxTokens: 2048 });
  const parsed = extractJsonFn(text);
  if (!Array.isArray(parsed)) {
    throw new Error("AI discovery response was not a JSON array");
  }
  return parsed.filter((c) => c && typeof c.domain === "string" && c.domain.trim()).slice(0, count);
}

export function extractContactEmail(html) {
  const $ = cheerio.load(html || "");
  let email;
  $("a[href^='mailto:']").each((_, el) => {
    if (email) return;
    email = $(el).attr("href").replace(/^mailto:/i, "").split("?")[0].trim();
  });
  if (!email) {
    const match = String(html || "").match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (match) email = match[0];
  }
  return email;
}

// Fetches robots.txt + a fixed list of guessed contact-page paths for one
// candidate domain, then upserts a SeoOpportunity. Never follows arbitrary
// links found on the fetched pages.
export async function fetchAndScoreCandidate({ domain, category, opportunityType, organizationName, rationale }) {
  const { fetch: cfg } = await getDiscoverySettings();
  const sourceKey = `ai-seed:${domain}:${category}`;

  const existing = await SeoOpportunity.findOne({ sourceKey }).lean();
  if (existing) {
    return { skipped: true, reason: "already discovered", sourceKey };
  }

  const homepageUrl = `https://${domain}`;
  const allowed = await isFetchAllowed(homepageUrl, cfg.userAgent);

  const doc = {
    recordType: "priority-opportunity",
    referringDomain: domain,
    organizationName,
    opportunityType,
    industry: category,
    discoverySource: "ai-seed",
    discoveryRawNotes: rationale,
    robotsAllowed: allowed,
    lastVerifiedAt: new Date(),
    sourceKey,
    status: "new",
  };

  if (!allowed) {
    doc.internalNotes = "robots.txt disallowed automated contact-page fetch — verify manually";
    doc.discoveryConfidenceScore = 20;
    doc.confidence = "Low";
    const created = await SeoOpportunity.create(doc);
    return { created, fetched: false };
  }

  let contactPageUrl;
  let contactEmail;
  try {
    for (const path of CONTACT_PATHS) {
      const url = `${homepageUrl}${path}`;
      const res = await throttledFetch(
        url,
        { headers: { "User-Agent": cfg.userAgent }, timeout: cfg.requestTimeoutMs },
        { minIntervalMs: cfg.rateLimitMs }
      );
      if (res.status >= 200 && res.status < 300) {
        contactPageUrl = url;
        contactEmail = extractContactEmail(res.data);
        break;
      }
    }
  } catch (err) {
    doc.internalNotes = `Contact page fetch failed: ${err.message}`;
  }

  doc.contactPageUrl = contactPageUrl;
  doc.contactEmail = contactEmail;
  doc.discoveryConfidenceScore = contactEmail ? 70 : contactPageUrl ? 45 : 25;
  doc.confidence = contactEmail ? "High" : contactPageUrl ? "Medium" : "Low";

  const created = await SeoOpportunity.create(doc);
  return { created, fetched: true };
}

// Orchestrates AI proposal + fetch/score for each category. `proposeFn` is
// injectable so callers/tests can skip the live AI call.
export async function runDiscoveryBatch({ categories, triggeredBy = "manual", proposeFn = proposeDiscoveryCandidates }) {
  const { candidatesPerRun } = await getDiscoverySettings();
  const summary = { proposed: 0, created: 0, skipped: 0, errors: 0 };

  for (const category of categories) {
    let candidates = [];
    try {
      candidates = await proposeFn({ category, count: candidatesPerRun });
    } catch (err) {
      console.error(`[Backlink Discovery] AI proposal failed for "${category}":`, err.message);
      summary.errors += 1;
      continue;
    }
    summary.proposed += candidates.length;

    for (const candidate of candidates) {
      try {
        const result = await fetchAndScoreCandidate({
          domain: candidate.domain,
          category,
          opportunityType: candidate.opportunityType,
          organizationName: candidate.organizationName,
          rationale: candidate.rationale,
        });
        if (result.skipped) summary.skipped += 1;
        else summary.created += 1;
      } catch (err) {
        console.error(`[Backlink Discovery] failed for ${candidate.domain}:`, err.message);
        summary.errors += 1;
      }
    }
  }

  await logSeoAudit(
    { admin: { email: "system" }, ip: "system" },
    "discovery.run",
    "SeoOpportunity",
    null,
    { ...summary, categories, triggeredBy }
  );
  return summary;
}
