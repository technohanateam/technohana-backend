// Pure course-priority scoring — NO database or network calls in this file.
// Trivially unit-testable with plain object inputs:
//   computeCoursePriorityScore({ enquiryCount90d: 12, ... }, { enquiry: 25, ... })

// Normalization caps — a judgment call absent a real historical distribution
// to calibrate against. Chosen so a "strong" course (roughly top-decile
// signal) lands near 100 without one outlier course dominating every other
// course's relative score.
//
// These are a FLOOR, not the only source of truth: a live validation run
// against Technohana's actual production data (2026-08-08, ~425 courses)
// found total 90-day course views catalogue-wide were ~2,300 — orders of
// magnitude below the 5000-view cap below — so every course's `views`
// component normalized to near-zero and the whole score collapsed to
// whatever `recency` alone contributed (itself uniform across ~406 of 425
// courses, since only 19 blogs exist total). The caller
// (coursePriorityAggregation.service.js) computes the actual observed max
// per run and passes tighter dynamic caps via the optional `caps` param
// below, falling back to these DEFAULT_CAPS only as a floor for extremely
// sparse data (so a single fluke view/enquiry doesn't make one course look
// maximally hot). This function itself stays pure — no DB access, caps are
// just another plain-object argument.
export const DEFAULT_CAPS = {
  enquiryCount90d: 40, // ~1.3 enquiries/day sustained is a very hot course
  orderRevenue90d: 500000, // in the base pricing minor unit's home currency (INR-equivalent)
  courseViews90d: 5000,
  gscClicks28d: 500,
  gscImpressions28d: 20000,
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Linear min-max against a cap, not log-scale — simpler to reason about and
// tune for a v1 with no real historical data to justify a log curve yet.
function normalizeLinear(value, cap) {
  const v = Number(value) || 0;
  if (cap <= 0) return 0;
  return clamp((v / cap) * 100, 0, 100);
}

// Recency is inverted — fewer days since the last blog means less urgency
// (already covered recently), more days means higher priority. Capped at
// 180 days so a course that has literally never had a post doesn't
// dominate purely on staleness.
function normalizeRecency(daysSinceLastBlog) {
  const days = daysSinceLastBlog == null ? 180 : Number(daysSinceLastBlog);
  if (!Number.isFinite(days)) return 100;
  return clamp((clamp(days, 0, 180) / 180) * 100, 0, 100);
}

const DEFAULT_WEIGHTS = { enquiry: 25, revenue: 25, views: 15, gscClicks: 15, gscImpressions: 10, recency: 10 };

export function computeCoursePriorityScore(inputs = {}, weights = DEFAULT_WEIGHTS, caps = DEFAULT_CAPS) {
  const {
    enquiryCount90d = 0,
    orderRevenue90d = 0,
    courseViews90d = 0,
    gscClicks28d = 0,
    gscImpressions28d = 0,
    daysSinceLastBlog = null,
  } = inputs;

  const w = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const c = { ...DEFAULT_CAPS, ...(caps || {}) };
  const weightSum = Object.values(w).reduce((sum, x) => sum + (Number(x) || 0), 0) || 1;

  const normalized = {
    enquiry: normalizeLinear(enquiryCount90d, c.enquiryCount90d),
    revenue: normalizeLinear(orderRevenue90d, c.orderRevenue90d),
    views: normalizeLinear(courseViews90d, c.courseViews90d),
    gscClicks: normalizeLinear(gscClicks28d, c.gscClicks28d),
    gscImpressions: normalizeLinear(gscImpressions28d, c.gscImpressions28d),
    recency: normalizeRecency(daysSinceLastBlog),
  };

  // Weighted proportionally — weights don't need to sum to 100 exactly,
  // dividing by their actual sum keeps the result in 0-100 regardless.
  let weighted = 0;
  for (const key of Object.keys(normalized)) {
    weighted += normalized[key] * ((Number(w[key]) || 0) / weightSum);
  }

  const score = Math.round(clamp(weighted, 0, 100));
  const tier = score >= 75 ? "TIER_1_STRATEGIC" : score >= 50 ? "TIER_2_GROWTH" : score >= 25 ? "TIER_3_EVERGREEN" : "TIER_4_LONG_TAIL";

  return { score, tier };
}
