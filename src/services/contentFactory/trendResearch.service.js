// Milestone 5 — real trend research. Batched PER TOPIC CLUSTER (never
// per-course — there are ~10-15 clusters vs 350+ courses, so this keeps
// AI spend bounded regardless of catalog size). Each cluster gets ONE
// Claude call with web_search access via the shared claudeWebSearchLoop util
// (same pattern factChecker.service.js already uses), asking for genuinely
// current developments with real, search-found sources only — never
// fabricated claims/sources (see trendResearch.prompt.js).
//
// Cost cap: settings.maxDailyResearchCalls is a HARD cap on how many
// cluster-research calls run in one invocation. When there are more
// eligible clusters than the cap allows, clusters are prioritized by
// TopicCluster.priority (descending) first, then by which have gone longest
// without being researched (lastResearchedAt ascending, nulls first) as the
// tiebreaker — documented in docs/AI_CONTENT_FACTORY_IMPLEMENTATION.md.
import TopicCluster from "../../models/topicCluster.model.js";
import Course from "../../models/course.model.js";
import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";
import { runClaudeWebSearchLoop } from "../../utils/claudeWebSearchLoop.js";
import { parseModelJson } from "../../utils/parseModelJson.js";
import { recordAiUsage } from "./aiUsageTracker.service.js";
import { enforceBudgetOrPause } from "./budgetGuard.service.js";
import { buildTrendResearchPrompt } from "../../prompts/contentFactory/trendResearch.prompt.js";

const DEFAULT_MATCH_THRESHOLD = 0.3;

function tokenize(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((t) => t.length > 2) // drop very short/noise tokens
  );
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// PURE function — no DB/network. Scores a single trend against a pre-loaded
// course catalog summary (array of { courseSlug, courseTitle, category,
// description }) using simple keyword/token-overlap (Jaccard on normalized
// tokens of trend text vs course text), boosted when the course's category
// literally matches the trend's cluster. Only matches above `threshold` are
// kept, sorted by relevanceScore descending. Trivially unit-testable with
// plain objects — mirrors duplicateDetection.service.js's purity contract.
export function matchTrendToCourses(trend, courseCatalogSummary = [], threshold = DEFAULT_MATCH_THRESHOLD) {
  const trendTokens = tokenize(`${trend?.topic || ""} ${trend?.summary || ""}`);
  if (trendTokens.size === 0) return [];

  const matches = [];
  for (const course of courseCatalogSummary) {
    const courseTokens = tokenize(`${course.courseTitle || ""} ${course.category || ""} ${course.description || ""}`);
    let score = jaccard(trendTokens, courseTokens);
    // Category/cluster boost: if the trend's cluster explicitly lists this
    // course's category, nudge the score up rather than relying on token
    // overlap alone (category strings are often short and lose to Jaccard).
    if (trend?.clusterCategories?.includes(course.category)) {
      score = Math.min(1, score + 0.2);
    }
    if (score >= threshold) {
      matches.push({ courseSlug: course.courseSlug, relevanceScore: Math.round(score * 100) / 100 });
    }
  }

  return matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// PURE function — no DB/network. Reduces a trends[] array (each already
// carrying matchedCourses) down to a per-course best-trend trendScore
// (0-100), used by contentStrategy.service.js to attach trendScore onto
// newly created opportunities for that course.
export function buildCourseTrendScoreMap(trends = []) {
  const map = {};
  for (const trend of trends) {
    for (const match of trend.matchedCourses || []) {
      const score = Math.round((match.relevanceScore || 0) * 100);
      if (!map[match.courseSlug] || score > map[match.courseSlug]) {
        map[match.courseSlug] = score;
      }
    }
  }
  return map;
}

async function loadCourseCatalogSummary() {
  const courses = await Course.find(
    {},
    { courseSlug: 1, courseTitle: 1, category: 1, overview: 1, courseObjective: 1, _id: 0 }
  ).lean();
  return courses
    .filter((c) => c.courseSlug)
    .map((c) => ({
      courseSlug: c.courseSlug,
      courseTitle: c.courseTitle,
      category: c.category,
      description: `${c.overview || ""} ${c.courseObjective || ""}`.slice(0, 500),
    }));
}

// Selects which clusters get a real research call this run, respecting
// maxDailyResearchCalls. Priority order: TopicCluster.priority desc, then
// least-recently-researched first (nulls — never researched — sort first).
function selectClustersForResearch(clusters, maxCalls) {
  const sorted = [...clusters].sort((a, b) => {
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    const aTime = a.lastResearchedAt ? new Date(a.lastResearchedAt).getTime() : 0;
    const bTime = b.lastResearchedAt ? new Date(b.lastResearchedAt).getTime() : 0;
    return aTime - bTime; // never-researched (0) sorts first
  });
  return sorted.slice(0, Math.max(0, maxCalls));
}

// Real Milestone 5 implementation. Same export name/signature as the M4
// stub so dailyPlanningJob.processor.js's call site doesn't change.
export async function researchTrends() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const settings = await getOrCreateContentFactorySettings();
  const maxCalls = settings.maxDailyResearchCalls || 15;

  if (!apiKey) {
    console.warn("[content-factory] researchTrends: ANTHROPIC_API_KEY not configured, skipping.");
    return { trends: [] };
  }

  const clusters = await TopicCluster.find().lean();
  if (clusters.length === 0) return { trends: [] };

  const selected = selectClustersForResearch(clusters, maxCalls);
  const courseCatalogSummary = await loadCourseCatalogSummary();

  const trends = [];
  for (const cluster of selected) {
    // Re-check budget before EACH cluster call — trend research is now real
    // paid spend, not a free stub, and a run can breach budget partway
    // through a multi-cluster loop.
    // eslint-disable-next-line no-await-in-loop
    const budgetCheck = await enforceBudgetOrPause(await getOrCreateContentFactorySettings());
    if (budgetCheck.paused) {
      console.warn(`[content-factory] researchTrends: stopping early — ${budgetCheck.reason}`);
      break;
    }

    try {
      const { system, prompt } = buildTrendResearchPrompt({ cluster });
      // eslint-disable-next-line no-await-in-loop
      const { finalText, usage, model } = await runClaudeWebSearchLoop({
        apiKey,
        system,
        prompt,
        model: "claude-sonnet-5",
        maxTokens: 3072,
        maxTurns: 4,
        timeout: 90000,
      });

      // eslint-disable-next-line no-await-in-loop
      await recordAiUsage({
        model,
        tier: "standard",
        tokensIn: usage?.input_tokens || 0,
        tokensOut: usage?.output_tokens || 0,
        callType: "trendResearch",
      });

      if (!finalText) continue;

      let parsed;
      try {
        parsed = parseModelJson(finalText);
      } catch (err) {
        console.error(`[content-factory] researchTrends: failed to parse response for cluster ${cluster.slug}:`, err.message);
        continue;
      }

      const clusterTrends = Array.isArray(parsed.trends) ? parsed.trends : [];
      for (const t of clusterTrends) {
        if (!t?.topic) continue;
        const sourceUrls = Array.isArray(t.sourceUrls) ? t.sourceUrls.filter((u) => typeof u === "string" && u.startsWith("http")) : [];
        // Never keep a trend with zero real sources — mirrors factChecker's
        // "no fabricated claims" rule: a trend with no verifiable source is
        // dropped rather than kept with an invented URL.
        if (sourceUrls.length === 0) continue;

        const trendForMatching = { topic: t.topic, summary: t.summary || "", clusterCategories: cluster.categories || [] };
        const matchedCourses = matchTrendToCourses(trendForMatching, courseCatalogSummary, DEFAULT_MATCH_THRESHOLD);

        trends.push({
          topic: String(t.topic).slice(0, 200),
          summary: String(t.summary || "").slice(0, 1000),
          sourceUrls,
          cluster: cluster.name,
          clusterId: cluster._id,
          matchedCourses,
        });
      }

      // eslint-disable-next-line no-await-in-loop
      await TopicCluster.updateOne({ _id: cluster._id }, { $set: { lastResearchedAt: new Date() } });
    } catch (err) {
      console.error(`[content-factory] researchTrends: cluster ${cluster.slug} failed:`, err.message);
    }
  }

  return { trends };
}
