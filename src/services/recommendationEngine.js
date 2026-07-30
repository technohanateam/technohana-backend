import SeoCrawlPage from "../models/seoCrawlPage.model.js";
import SeoGscMetric from "../models/seoGscMetric.model.js";
import SeoGa4Metric from "../models/seoGa4Metric.model.js";
import SeoRecommendation from "../models/seoRecommendation.model.js";
import SeoOpportunity from "../models/seoOpportunity.model.js";
import SeoContact from "../models/seoContact.model.js";
import SeoMonitoring from "../models/seoMonitoring.model.js";
import SeoSettings from "../models/seoSettings.model.js";

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

const BACKLINK_RULES = [
  {
    code: "HIGH_VALUE_UNCONTACTED_OPPORTUNITY",
    category: "backlink",
    priority: "high",
    impact: "high",
    effort: "low",
    confidence: "high",
  },
  {
    code: "STALLED_OUTREACH_NO_FOLLOWUP",
    category: "backlink",
    priority: "medium",
    impact: "medium",
    effort: "low",
    confidence: "medium",
  },
  {
    code: "LOST_LINK_NEEDS_REOUTREACH",
    category: "backlink",
    priority: "high",
    impact: "medium",
    effort: "medium",
    confidence: "high",
  },
  {
    code: "COMPETITOR_GAP_HIGH_SCORE",
    category: "backlink",
    priority: "medium",
    impact: "high",
    effort: "medium",
    confidence: "medium",
  },
];

const STALE_UNCONTACTED_DAYS = 3;

export async function generateRecommendationsFromBacklinks() {
  const settings = await SeoSettings.findOne().lean();
  const highThreshold = settings?.priorityThresholds?.high ?? 70;
  const staleCutoff = new Date(Date.now() - STALE_UNCONTACTED_DAYS * 24 * 60 * 60 * 1000);

  const rule = (code) => BACKLINK_RULES.find((r) => r.code === code);

  // HIGH_VALUE_UNCONTACTED_OPPORTUNITY — high-scoring priority opportunities
  // sitting untouched for a few days.
  const uncontacted = await SeoOpportunity.find({
    recordType: "priority-opportunity",
    status: "new",
    overallScore: { $gte: highThreshold },
    createdAt: { $lte: staleCutoff },
  }).lean();
  for (const opp of uncontacted) {
    const r = rule("HIGH_VALUE_UNCONTACTED_OPPORTUNITY");
    await upsertRecommendation({
      ruleCode: r.code,
      category: r.category,
      title: `High-value opportunity awaiting outreach: ${opp.referringDomain || opp.organizationName}`,
      priority: r.priority,
      impact: r.impact,
      effort: r.effort,
      confidence: r.confidence,
      affectedUrl: opp.referringDomain,
      evidence: { opportunityId: opp._id, overallScore: opp.overallScore },
    });
  }

  // STALLED_OUTREACH_NO_FOLLOWUP — contacted, follow-up date has passed, no
  // follow-up has actually been logged as completed.
  const stalledContacts = await SeoContact.find({
    status: { $in: ["contacted", "email-sent"] },
    nextFollowUp: { $lte: new Date() },
  }).lean();
  for (const contact of stalledContacts) {
    const hasCompletedFollowUp = (contact.followUps || []).some((f) => f.completed);
    if (hasCompletedFollowUp) continue;
    const r = rule("STALLED_OUTREACH_NO_FOLLOWUP");
    await upsertRecommendation({
      ruleCode: r.code,
      category: r.category,
      title: `Outreach stalled, no follow-up logged: ${contact.contactName || contact.company || contact.website}`,
      priority: r.priority,
      impact: r.impact,
      effort: r.effort,
      confidence: r.confidence,
      affectedUrl: contact.website,
      evidence: { contactId: contact._id, nextFollowUp: contact.nextFollowUp },
    });
  }

  // LOST_LINK_NEEDS_REOUTREACH — a link that's gone dark with no active
  // re-outreach contact already in flight for it.
  const lostLinks = await SeoMonitoring.find({ linkStatus: "lost" }).lean();
  for (const link of lostLinks) {
    const activeReoutreach = link.opportunityId
      ? await SeoContact.findOne({
          opportunityId: link.opportunityId,
          status: { $nin: ["declined", "archived", "lost-link"] },
        }).lean()
      : null;
    if (activeReoutreach) continue;
    const r = rule("LOST_LINK_NEEDS_REOUTREACH");
    await upsertRecommendation({
      ruleCode: r.code,
      category: r.category,
      title: `Lost backlink needs re-outreach: ${link.website}`,
      priority: r.priority,
      impact: r.impact,
      effort: r.effort,
      confidence: r.confidence,
      affectedUrl: link.liveUrl || link.website,
      evidence: { monitoringId: link._id },
    });
  }

  // COMPETITOR_GAP_HIGH_SCORE — high-scoring competitor gaps not yet acted on.
  const competitorGaps = await SeoOpportunity.find({
    recordType: "competitor-gap",
    status: "new",
    overallScore: { $gte: highThreshold },
  }).lean();
  for (const gap of competitorGaps) {
    const r = rule("COMPETITOR_GAP_HIGH_SCORE");
    await upsertRecommendation({
      ruleCode: r.code,
      category: r.category,
      title: `${gap.competitor || "A competitor"} has a high-value gap: ${gap.referringDomain}`,
      priority: r.priority,
      impact: r.impact,
      effort: r.effort,
      confidence: r.confidence,
      affectedUrl: gap.referringDomain,
      evidence: { opportunityId: gap._id, competitor: gap.competitor, overallScore: gap.overallScore },
    });
  }

  return {
    uncontacted: uncontacted.length,
    stalled: stalledContacts.length,
    lostLinks: lostLinks.length,
    competitorGaps: competitorGaps.length,
  };
}

export { CRAWL_ISSUE_RULES, BACKLINK_RULES };
