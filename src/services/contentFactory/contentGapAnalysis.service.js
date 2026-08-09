// Milestone 5 — real SEO content-gap analysis. Reads ALREADY-SYNCED
// SeoGscMetric rows only — no new external API calls, no competitor
// scraping/fetching, ever (per the plan, this is strategy-only).
//
// Design choice: purely deterministic aggregation, no Claude call. A
// "content gap" here is a search query Technohana already ranks/shows for
// (it's in GSC) with real visibility (impressions) but weak engagement
// (low CTR) — that's a genuine, mechanically-detectable signal that either
// no content targets that query well, or existing content underperforms
// for it. Turning "high impressions + low CTR" into a suggestedAngle is a
// simple template, not a creative judgment call that benefits from an LLM,
// so a Claude call would add cost/latency without adding signal quality.
// contentGapAnalysis.prompt.js is intentionally NOT created for this reason
// (see docs/AI_CONTENT_FACTORY_IMPLEMENTATION.md "As-built — Milestone 5").
import SeoGscMetric from "../../models/seoGscMetric.model.js";
import Course from "../../models/course.model.js";

const DEFAULT_IMPRESSIONS_THRESHOLD = 100;
const DEFAULT_CTR_THRESHOLD = 0.02; // 2% — queries below this with real impressions are weak-engagement signals
const DEFAULT_MAX_GAPS = 20;
const MATCH_THRESHOLD = 0.25;

function tokenize(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((t) => t.length > 2)
  );
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// PURE function — no DB/network. Same token-overlap approach as
// trendResearch.service.js's matchTrendToCourses, kept as a small local
// duplicate (mirrors duplicateDetection.service.js's precedent of a
// self-contained pure scoring fn per service) rather than a shared import,
// since the two inputs (a trend vs a raw GSC query string) are different
// enough shapes that sharing would need an awkward adapter.
export function matchGapQueryToCourses(query, courseCatalogSummary = [], threshold = MATCH_THRESHOLD) {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return [];
  const matches = [];
  for (const course of courseCatalogSummary) {
    const courseTokens = tokenize(`${course.courseTitle || ""} ${course.category || ""}`);
    const score = jaccard(queryTokens, courseTokens);
    if (score >= threshold) {
      matches.push({ courseSlug: course.courseSlug, relevanceScore: Math.round(score * 100) / 100 });
    }
  }
  return matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// PURE function — no DB/network. Deterministic template, not an AI call —
// see module header for why.
export function buildSuggestedAngle(gapRow, bestMatch) {
  const target = bestMatch ? `for "${bestMatch.courseTitle}"` : "with a dedicated piece";
  return `"${gapRow.query}" already gets ${gapRow.impressions} impressions but only ${(gapRow.ctr * 100).toFixed(1)}% CTR — ` +
    `create or refresh content that directly answers this query's intent ${target}, with the query phrase in the title/H1 and opening paragraph.`;
}

// PURE function — no DB/network. Reduces a gaps[] array (each already
// carrying matchedCourses) down to a per-course seoOpportunityScore (0-100),
// used by contentStrategy.service.js to attach seoOpportunityScore onto
// newly created opportunities for that course. Score scales with both the
// query's impression volume (visibility already exists) and how strongly it
// matched this specific course (relevanceScore 0-1); the best (highest)
// contributing gap wins per course, mirroring trendResearch's
// buildCourseTrendScoreMap.
export function buildCourseGapSignalMap(gaps = []) {
  const map = {};
  for (const gap of gaps) {
    const impressionsFactor = Math.min(100, Math.round((gap.impressions || 0) / 5)); // 500+ impressions -> maxed out
    for (const match of gap.matchedCourses || []) {
      const score = Math.round(impressionsFactor * (match.relevanceScore || 0));
      const existing = map[match.courseSlug];
      if (!existing || score > existing.seoOpportunityScore) {
        map[match.courseSlug] = { seoOpportunityScore: score, query: gap.query };
      }
    }
  }
  return map;
}

async function loadCourseCatalogSummary() {
  const courses = await Course.find({}, { courseSlug: 1, courseTitle: 1, category: 1, _id: 0 }).lean();
  return courses.filter((c) => c.courseSlug);
}

// Real Milestone 5 implementation. Same export name/signature as the M4
// stub so dailyPlanningJob.processor.js's call site doesn't change.
export async function analyzeContentGaps({
  impressionsThreshold = DEFAULT_IMPRESSIONS_THRESHOLD,
  ctrThreshold = DEFAULT_CTR_THRESHOLD,
  maxGaps = DEFAULT_MAX_GAPS,
} = {}) {
  const rows = await SeoGscMetric.find(
    { dimensionType: "query", impressions: { $gte: impressionsThreshold }, ctr: { $lt: ctrThreshold } },
    { dimensionValue: 1, impressions: 1, clicks: 1, ctr: 1, _id: 0 }
  )
    .sort({ impressions: -1 })
    .limit(maxGaps * 2) // over-fetch a bit before per-query dedup below
    .lean();

  if (rows.length === 0) return { gaps: [] };

  // dimensionValue rows are a rolling-window snapshot per query already
  // (unique per propertyId+dimensionType+dimensionValue for non-"date" rows
  // per seoGscMetric.model.js's index), but dedupe defensively by query text
  // in case of multiple GSC properties, keeping the highest-impression row.
  const byQuery = new Map();
  for (const row of rows) {
    const query = row.dimensionValue;
    const existing = byQuery.get(query);
    if (!existing || row.impressions > existing.impressions) byQuery.set(query, row);
  }

  const courseCatalogSummary = await loadCourseCatalogSummary();
  const courseBySlug = new Map(courseCatalogSummary.map((c) => [c.courseSlug, c]));

  const gaps = [...byQuery.values()]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, maxGaps)
    .map((row) => {
      const gapRow = { query: row.dimensionValue, impressions: row.impressions, ctr: row.ctr, clicks: row.clicks };
      const matchedCourses = matchGapQueryToCourses(gapRow.query, courseCatalogSummary, MATCH_THRESHOLD);
      const bestMatch = matchedCourses[0] ? courseBySlug.get(matchedCourses[0].courseSlug) : null;
      return {
        query: gapRow.query,
        impressions: gapRow.impressions,
        ctr: gapRow.ctr,
        matchedCourses,
        suggestedAngle: buildSuggestedAngle(gapRow, bestMatch),
      };
    });

  return { gaps };
}
