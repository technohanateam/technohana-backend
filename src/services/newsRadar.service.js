import Parser from "rss-parser";
import NewsItem from "../models/newsItem.model.js";
import AiUsageLog from "../models/aiUsageLog.model.js";
import { getOrCreateContentFactorySettings } from "../models/contentFactorySettings.model.js";
import { checkBudget } from "./contentFactory/budgetGuard.service.js";
import { trackedCallClaude } from "./contentFactory/aiUsageTracker.service.js";
import { parseModelJson } from "../utils/parseModelJson.js";

// weight 1-3: how much a headline from this source is worth by default.
export const NEWS_FEEDS = [
  { source: "OpenAI", url: "https://openai.com/news/rss.xml", weight: 3 },
  { source: "Google AI", url: "https://blog.google/technology/ai/rss/", weight: 3 },
  { source: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", weight: 2 },
  { source: "Meta Engineering", url: "https://engineering.fb.com/category/ml-applications/feed/", weight: 1 },
  { source: "Microsoft AI", url: "https://news.microsoft.com/source/topics/ai/feed/", weight: 2 },
  { source: "NVIDIA", url: "https://blogs.nvidia.com/blog/category/generative-ai/feed/", weight: 1 },
  { source: "AWS Machine Learning", url: "https://aws.amazon.com/blogs/machine-learning/feed/", weight: 1 },
  { source: "Hugging Face", url: "https://huggingface.co/blog/feed.xml", weight: 2 },
  { source: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", weight: 2 },
  { source: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", weight: 1 },
];

// Official YouTube channels (RSS, no API key). Link/embed only.
export const VIDEO_FEEDS = [
  { source: "Anthropic", channelId: "UCrDwWp7EBBv4NwvScIpBDOA", weight: 3 },
  { source: "OpenAI", channelId: "UCXZCJLdBC09xxGZ6gcdrc6A", weight: 3 },
  { source: "Google DeepMind", channelId: "UCP7jMXSY2xbc3KCAE0MHQ-A", weight: 2 },
  { source: "Google", channelId: "UCK8sQmJBp8GCxrOtXWBpyEA", weight: 2 },
  { source: "Microsoft", channelId: "UCFtEEv80fQVKkD4h1PF-Xqw", weight: 1 },
  { source: "NVIDIA", channelId: "UCHuiy8bXnmK5nisYHUd1J5g", weight: 1 },
].map((f) => ({ ...f, kind: "VIDEO", url: `https://www.youtube.com/feeds/videos.xml?channel_id=${f.channelId}` }));

const KEYWORDS = [
  "launch", "release", "introduc", "announc", "new model", "agent", "claude", "gpt", "gemini", "copilot",
  "llm", "open source", "api", "feature", "update", "automation", "workflow", "prompt", "free",
];

const MAX_AGE_HOURS = 48;
const BREAKING_AGE_HOURS = 3;
const MIN_SCORE_FOR_AI = 3;
const MAX_ITEMS_PER_AI_CALL = 15;
const MAX_AI_CALLS_PER_DAY = 12;
const AI_CALL_ESTIMATE_USD = 0.02;
const AI_CALL_TYPE = "newsRadarScoring";

const parser = new Parser({
  timeout: 10000,
  headers: { "User-Agent": "TechnohanaNewsRadar/1.0" },
  customFields: { item: [["yt:videoId", "videoId"]] },
});

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    [...u.searchParams.keys()].filter((k) => k.startsWith("utm_")).forEach((k) => u.searchParams.delete(k));
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function heuristicScore(title, snippet, weight, ageHours) {
  const text = `${title} ${snippet || ""}`.toLowerCase();
  const hits = KEYWORDS.filter((k) => text.includes(k)).length;
  const recency = ageHours < 3 ? 3 : ageHours < 12 ? 2 : ageHours < 24 ? 1 : 0;
  return weight + Math.min(hits, 4) + recency;
}

async function fetchFeed(feed) {
  const parsed = await parser.parseURL(feed.url);
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;
  return (parsed.items || [])
    .map((it) => {
      const url = normalizeUrl(it.link);
      const publishedAt = new Date(it.isoDate || it.pubDate || Date.now());
      if (!url || !it.title || Number.isNaN(publishedAt.getTime()) || publishedAt.getTime() < cutoff) return null;
      const isVideo = feed.kind === "VIDEO";
      const videoId = isVideo ? it.videoId || null : null;
      if (isVideo && !videoId) return null;
      const snippet = stripHtml(it.contentSnippet || it.summary || "").slice(0, 280) || null;
      const ageHours = (Date.now() - publishedAt.getTime()) / 3600000;
      const score = heuristicScore(it.title, snippet, feed.weight, ageHours);
      return {
        url,
        title: stripHtml(it.title).slice(0, 300),
        source: feed.source,
        publishedAt,
        snippet,
        kind: isVideo ? "VIDEO" : "ARTICLE",
        videoId,
        thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
        heuristicScore: score,
        breaking: feed.weight >= 3 && ageHours <= BREAKING_AGE_HOURS && score >= 6,
      };
    })
    .filter(Boolean);
}

async function aiCallsToday() {
  return AiUsageLog.countDocuments({ date: new Date().toISOString().slice(0, 10), callType: AI_CALL_TYPE });
}

async function scoreWithClaude(items) {
  const list = items.map((it, i) => `${i + 1}. [${it.source}] ${it.title}${it.snippet ? ` — ${it.snippet}` : ""}`).join("\n");
  const { text } = await trackedCallClaude({
    system:
      "You pick AI news for Technohana, an online training academy for working professionals in India (project managers, analysts, HR, finance, developers). " +
      "You respond with JSON only.",
    prompt: `Score each AI headline 1-10 for how likely it is to get saves and shares from working professionals, and how useful it is to them. Ignore pure funding/stock news (score 1-3).

${list}

Respond with ONLY a JSON object:
{ "items": [ { "n": 1, "score": 8, "whyItMatters": "one plain sentence, max 25 words", "angle": "one post angle, max 15 words" } ] }`,
    maxTokens: 1500,
    tier: "cheap",
    callType: AI_CALL_TYPE,
  });
  const parsed = parseModelJson(text);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

export async function runNewsRadar({ triggeredBy = "CRON" } = {}) {
  const allFeeds = [...NEWS_FEEDS, ...VIDEO_FEEDS];
  const results = await Promise.allSettled(allFeeds.map(fetchFeed));
  const failedFeeds = [];
  const fetched = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") fetched.push(...r.value);
    else failedFeeds.push(`${allFeeds[i].source}${allFeeds[i].kind === "VIDEO" ? " (video)" : ""}`);
  });

  const existing = new Set((await NewsItem.find({ url: { $in: fetched.map((f) => f.url) } }).select("url").lean()).map((e) => e.url));
  const fresh = fetched.filter((f) => !existing.has(f.url));

  let inserted = [];
  if (fresh.length) {
    try {
      inserted = await NewsItem.insertMany(fresh, { ordered: false });
    } catch (err) {
      // duplicate-key races between overlapping runs are fine
      inserted = err.insertedDocs || [];
      if (!err.writeErrors) throw err;
    }
  }

  let scored = 0;
  const candidates = inserted
    .filter((d) => d.heuristicScore >= MIN_SCORE_FOR_AI)
    .sort((a, b) => b.heuristicScore - a.heuristicScore)
    .slice(0, MAX_ITEMS_PER_AI_CALL);

  if (candidates.length && process.env.ANTHROPIC_API_KEY) {
    const settings = await getOrCreateContentFactorySettings();
    const budget = checkBudget(settings, AI_CALL_ESTIMATE_USD);
    if (budget.allowed && (await aiCallsToday()) < MAX_AI_CALLS_PER_DAY) {
      try {
        const scores = await scoreWithClaude(candidates);
        for (const s of scores) {
          const doc = candidates[Number(s.n) - 1];
          if (!doc) continue;
          doc.aiScore = Math.max(1, Math.min(10, Number(s.score) || 0));
          doc.whyItMatters = String(s.whyItMatters || "").slice(0, 300) || null;
          doc.angle = String(s.angle || "").slice(0, 200) || null;
          doc.scoredAt = new Date();
          await doc.save();
          scored += 1;
        }
      } catch (err) {
        console.error("[NewsRadar] AI scoring failed (headlines kept with heuristic score):", err.message);
      }
    }
  }

  console.log(`[NewsRadar] ${triggeredBy}: fetched ${fetched.length}, new ${inserted.length}, AI-scored ${scored}, failed feeds: ${failedFeeds.join(", ") || "none"}`);
  return { fetched: fetched.length, inserted: inserted.length, scored, failedFeeds };
}
