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

export async function getDiscoverySettings() {
  const settings = await SeoSettings.findOne().lean();
  return {
    fetch: { ...DEFAULT_DISCOVERY_FETCH_SETTINGS, ...(settings?.backlinkVerification || {}) },
    candidatesPerRun: settings?.discovery?.candidatesPerRun ?? 15,
  };
}

function buildDiscoveryCandidatesPrompt({ category, count }) {
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
  return { system, prompt };
}

function parseDiscoveryCandidatesResponse(text, { count, extractJsonFn = extractJson }) {
  const parsed = extractJsonFn(text);
  if (!Array.isArray(parsed)) {
    throw new Error("AI discovery response was not a JSON array");
  }
  return parsed.filter((c) => c && typeof c.domain === "string" && c.domain.trim()).slice(0, count);
}

// Asks Claude to propose real, plausible websites for a category. Used by
// the weekly cron / queue-based discovery path (backlinkQueue.js) — left
// calling the live API on purpose, same rationale as researchTrends() in
// trendResearch.service.js: a Bull worker has no human present to paste a
// Claude Pro response back mid-run, so this path just throws (and
// runDiscoveryBatch counts it as an error and moves on) when
// ANTHROPIC_API_KEY has no working billing. `callClaudeFn`/`extractJsonFn`
// stay injectable for testing without hitting the Anthropic API. The
// separate, admin-triggered manual alternative is
// buildManualDiscoveryPromptForCategory / parseManualDiscoveryResponse below.
export async function proposeDiscoveryCandidates({ category, count = 10, callClaudeFn = callClaude, extractJsonFn = extractJson }) {
  const { system, prompt } = buildDiscoveryCandidatesPrompt({ category, count });
  const { text } = await callClaudeFn({ system, prompt, maxTokens: 2048 });
  return parseDiscoveryCandidatesResponse(text, { count, extractJsonFn });
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

// ── Manual Claude Pro workflow (admin-triggered, bypasses the Bull queue) ───
//
// runDiscoveryBatch() above runs inside a Bull worker (weekly cron, or an
// admin button that just enqueues a job) — no HTTP request is open for a
// human to paste a response into mid-run, so that path stays on the live
// API and just errors per-category (counted in summary.errors) when
// ANTHROPIC_API_KEY has no working billing. This is the separate,
// synchronous, admin-triggered alternative: "Discover Backlinks Now" walks
// each category's prompt one at a time, pausing for the admin to paste the
// Claude Pro response before fetching/scoring that category's candidates
// and moving to the next — same shape as the manual trend-research flow in
// trendResearch.service.js. No cost tracking (manual usage isn't billed
// through the API key).

// Builds the prompt for one category — the admin UI calls this once per
// category as it advances through the queue.
export function buildManualDiscoveryPromptForCategory(category, count) {
  return buildDiscoveryCandidatesPrompt({ category, count });
}

// Parses the admin's pasted response for one category, then fetches/scores
// each candidate exactly like runDiscoveryBatch()'s inner loop (robots.txt +
// contact-page lookup, upsert as SeoOpportunity). Returns the same
// per-category tally shape runDiscoveryBatch() accumulates.
export async function parseManualDiscoveryResponseForCategory(category, text, count) {
  const parsed = parseDiscoveryCandidatesResponse(text, { count });
  const tally = { proposed: parsed.length, created: 0, skipped: 0, errors: 0 };

  for (const candidate of parsed) {
    try {
      const result = await fetchAndScoreCandidate({
        domain: candidate.domain,
        category,
        opportunityType: candidate.opportunityType,
        organizationName: candidate.organizationName,
        rationale: candidate.rationale,
      });
      if (result.skipped) tally.skipped += 1;
      else tally.created += 1;
    } catch (err) {
      console.error(`[Backlink Discovery] manual: failed for ${candidate.domain}:`, err.message);
      tally.errors += 1;
    }
  }

  return tally;
}
