import SeoCrawlPage from "../models/seoCrawlPage.model.js";
import SeoGscMetric from "../models/seoGscMetric.model.js";
import SeoGa4Metric from "../models/seoGa4Metric.model.js";
import SeoRecommendation from "../models/seoRecommendation.model.js";

const CRAWL_ISSUE_RULES = [
  {
    code: "MISSING_TITLE",
    category: "technical",
    title: "Add a page title",
    priority: "high",
    impact: "high",
    effort: "low",
    confidence: "high",
  },
  {
    code: "MISSING_META_DESCRIPTION",
    category: "technical",
    title: "Add a meta description",
    priority: "medium",
    impact: "medium",
    effort: "low",
    confidence: "high",
  },
  {
    code: "MISSING_H1",
    category: "technical",
    title: "Add an H1 heading",
    priority: "medium",
    impact: "medium",
    effort: "low",
    confidence: "high",
  },
  {
    code: "BROKEN_LINK",
    category: "technical",
    title: "Fix broken internal links",
    priority: "critical",
    impact: "high",
    effort: "low",
    confidence: "high",
  },
  {
    code: "MISSING_CANONICAL",
    category: "technical",
    title: "Add a canonical tag",
    priority: "medium",
    impact: "medium",
    effort: "low",
    confidence: "medium",
  },
  {
    code: "THIN_CONTENT",
    category: "content",
    title: "Expand thin content / create supporting article",
    priority: "medium",
    impact: "medium",
    effort: "high",
    confidence: "medium",
  },
  {
    code: "SLOW_PAGE",
    category: "performance",
    title: "Improve page speed",
    priority: "high",
    impact: "high",
    effort: "medium",
    confidence: "medium",
  },
  {
    code: "MISSING_ALT",
    category: "technical",
    title: "Add alt text to images",
    priority: "low",
    impact: "low",
    effort: "low",
    confidence: "high",
  },
];

async function upsertRecommendation({ ruleCode, category, title, priority, impact, effort, confidence, affectedUrl, evidence, sourceCrawlRunId }) {
  await SeoRecommendation.findOneAndUpdate(
    { ruleCode, affectedUrl: affectedUrl || null, status: "open" },
    {
      $set: {
        category,
        title,
        description: `${title} for ${affectedUrl || "the affected item"}.`,
        priority,
        impact,
        effort,
        confidence,
        evidence,
        sourceCrawlRunId,
        generatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

export async function generateRecommendationsFromCrawl(crawlRunId) {
  const pages = await SeoCrawlPage.find({ crawlRunId }).lean();
  for (const page of pages) {
    for (const issue of page.issues || []) {
      const rule = CRAWL_ISSUE_RULES.find((r) => r.code === issue);
      if (!rule) continue;
      await upsertRecommendation({
        ruleCode: rule.code,
        category: rule.category,
        title: rule.title,
        priority: rule.priority,
        impact: rule.impact,
        effort: rule.effort,
        confidence: rule.confidence,
        affectedUrl: page.url,
        evidence: { issue, url: page.url },
        sourceCrawlRunId: crawlRunId,
      });
    }
  }
}

export async function generateRecommendationsFromGsc(propertyId) {
  const rows = await SeoGscMetric.find({ propertyId, dimensionType: "query" })
    .sort({ date: -1 })
    .limit(500)
    .lean();

  for (const row of rows) {
    if (row.impressions > 1000 && row.ctr < 0.02) {
      await upsertRecommendation({
        ruleCode: "HIGH_IMPRESSIONS_LOW_CTR",
        category: "gsc",
        title: `Improve title/meta description for "${row.dimensionValue}"`,
        priority: "high",
        impact: "high",
        effort: "medium",
        confidence: "medium",
        affectedUrl: row.dimensionValue,
        evidence: { impressions: row.impressions, ctr: row.ctr, query: row.dimensionValue },
      });
    }
    if (row.position > 10 && row.position <= 20 && row.impressions > 100) {
      await upsertRecommendation({
        ruleCode: "RANKING_ON_PAGE2",
        category: "gsc",
        title: `Improve ranking for "${row.dimensionValue}" (page 2)`,
        priority: "high",
        impact: "high",
        effort: "medium",
        confidence: "high",
        affectedUrl: row.dimensionValue,
        evidence: { position: row.position, impressions: row.impressions, query: row.dimensionValue },
      });
    }
  }
}

export async function generateRecommendationsFromGa4(propertyId) {
  const rows = await SeoGa4Metric.find({ propertyId, dimensionType: "landingPage" })
    .sort({ date: -1 })
    .limit(500)
    .lean();

  for (const row of rows) {
    if (row.bounceRate > 0.7 && row.sessions > 50) {
      await upsertRecommendation({
        ruleCode: "HIGH_BOUNCE_LANDING_PAGE",
        category: "ga4",
        title: `Reduce bounce rate on ${row.dimensionValue}`,
        priority: "medium",
        impact: "medium",
        effort: "medium",
        confidence: "medium",
        affectedUrl: row.dimensionValue,
        evidence: { bounceRate: row.bounceRate, sessions: row.sessions },
      });
    }
  }
}

export { CRAWL_ISSUE_RULES };
