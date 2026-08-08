import Course from "../../models/course.model.js";
import CourseContentSettings from "../../models/courseContentSettings.model.js";
import TopicCluster from "../../models/topicCluster.model.js";
import ContentOpportunity, { CONTENT_TYPES } from "../../models/contentOpportunity.model.js";
import ContentRun from "../../models/contentRun.model.js";
import { Blogs } from "../../models/blogs.model.js";
import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";
import { refreshCoursePriorities, effectivePriority } from "./coursePriorityAggregation.service.js";
import { scoreDuplicateRisk } from "./duplicateDetection.service.js";
import { extractJson } from "../aiAgent.service.js";
import { trackedCallClaude } from "./aiUsageTracker.service.js";
import { buildSystemPrompt, buildUserPrompt } from "../../prompts/contentFactory/opportunityCandidateWriter.prompt.js";

// Days-due-per-frequency, used by isDueForContent().
const FREQUENCY_DAYS = {
  DAILY: 1,
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
  QUARTERLY: 90,
  ON_DEMAND: Infinity, // never auto-due — only generated on explicit admin action
};

// Pure helper — no DB/network — trivially unit-testable.
export function isDueForContent(settings, now = new Date()) {
  if (!settings || settings.enabled === false) return false;
  const frequency = settings.frequencyOverride || settings.frequency || "WEEKLY";
  const days = FREQUENCY_DAYS[frequency] ?? FREQUENCY_DAYS.WEEKLY;
  if (!Number.isFinite(days)) return false; // ON_DEMAND
  if (!settings.lastBlogGeneratedAt) return true;
  const elapsedDays = (now - new Date(settings.lastBlogGeneratedAt)) / (24 * 60 * 60 * 1000);
  return elapsedDays >= days;
}

// Pure helper — no DB/network — trivially unit-testable.
// Weighted combo: relevance + intent carry the most weight since they're
// AI-assessed against the actual candidate; course priority nudges toward
// courses the business cares about; duplicateScore is inverted (lower
// duplicate risk = higher final score) and always factors in even when 0.
export function computeOverallScore({ courseRelevanceScore = 0, businessIntentScore = 0, seoOpportunityScore = 0, duplicateScore = 0, coursePriorityScore = 0 }) {
  const duplicatePenaltyFactor = (100 - Math.min(100, Math.max(0, duplicateScore))) / 100;
  const base =
    courseRelevanceScore * 0.3 +
    businessIntentScore * 0.25 +
    seoOpportunityScore * 0.15 +
    coursePriorityScore * 0.3;
  return Math.round(Math.min(100, Math.max(0, base * duplicatePenaltyFactor)));
}

// Rotates content types not recently used for a given course, based on that
// course's most recent opportunities/blogs (recentTypesForCourse, newest first).
function pickContentType(recentTypesForCourse) {
  const recentSet = new Set(recentTypesForCourse.slice(0, 4));
  const unused = CONTENT_TYPES.filter((t) => !recentSet.has(t));
  if (unused.length > 0) return unused[0];
  // All types used recently — fall back to the least-recently-used one.
  return recentTypesForCourse[recentTypesForCourse.length - 1] || CONTENT_TYPES[0];
}

async function loadExistingCorpus() {
  const [blogs, opportunities] = await Promise.all([
    Blogs.find({}, { title: 1, slug: 1, focusKeyword: 1, category: 1 }).lean(),
    ContentOpportunity.find(
      { status: { $nin: ["REJECTED", "FAILED"] } },
      { title: 1, slug: 1, focusKeyword: 1, clusterId: 1, searchIntent: 1 }
    ).lean(),
  ]);

  return [
    ...blogs.map((b) => ({ id: b._id, title: b.title, slug: b.slug, focusKeyword: b.focusKeyword, source: "blog" })),
    ...opportunities.map((o) => ({
      id: o._id,
      title: o.title,
      slug: o.slug,
      focusKeyword: o.focusKeyword,
      clusterId: o.clusterId,
      searchIntent: o.searchIntent,
      source: "opportunity",
    })),
  ];
}

// Orchestrates the full Milestone-1 planning pipeline. Creates ContentOpportunity
// docs with status PLANNED only — never further, since M1 has no generation step.
// The dryRun flag has no behavioral effect in M1 (it becomes meaningful starting
// M2 when there's an actual generation step to skip) — both paths only ever
// create ContentOpportunity/ContentRun docs, never Blogs.
export async function generateOpportunityCandidates({ dryRun = true, triggeredBy = "MANUAL" } = {}) {
  const settings = await getOrCreateContentFactorySettings();

  const run = await ContentRun.create({
    runType: "PLANNING",
    triggeredBy,
    status: "RUNNING",
    dryRun,
    settingsSnapshot: settings.toObject ? settings.toObject() : settings,
  });

  const errors = [];
  let coursesEvaluated = 0;
  let opportunitiesCreated = 0;
  let opportunitiesSkippedDuplicate = 0;

  try {
    await refreshCoursePriorities({ force: false });

    const [eligibleSettings, clusters, courses, corpus, recentOpportunities] = await Promise.all([
      CourseContentSettings.find({ enabled: true }).lean(),
      TopicCluster.find().lean(),
      Course.find({}, { id: 1, courseSlug: 1, courseTitle: 1, category: 1, _id: 0 }).lean(),
      loadExistingCorpus(),
      ContentOpportunity.find({}, { courseSlug: 1, contentType: 1, createdAt: 1 }).sort({ createdAt: -1 }).lean(),
    ]);

    coursesEvaluated = eligibleSettings.length;

    const courseBySlug = new Map(courses.filter((c) => c.courseSlug).map((c) => [c.courseSlug, c]));
    const clusterByCategoryMap = new Map();
    for (const cluster of clusters) {
      for (const category of cluster.categories || []) {
        clusterByCategoryMap.set(category, cluster);
      }
    }
    const recentTypesByCourse = new Map();
    for (const opp of recentOpportunities) {
      if (!opp.courseSlug) continue;
      const list = recentTypesByCourse.get(opp.courseSlug) || [];
      list.push(opp.contentType);
      recentTypesByCourse.set(opp.courseSlug, list);
    }

    const now = new Date();

    // Rank courses: due-for-content first, then by effective priority score desc.
    const dueCandidates = eligibleSettings
      .filter((s) => isDueForContent(s, now))
      .map((s) => ({ settings: s, priority: effectivePriority(s) }))
      .sort((a, b) => b.priority.score - a.priority.score);

    const maxOpportunities = settings.maxDailyOpportunities || 20;
    const shortlisted = dueCandidates.slice(0, maxOpportunities);

    const candidates = shortlisted
      .map(({ settings: courseSettings, priority }) => {
        const course = courseBySlug.get(courseSettings.courseSlug);
        if (!course) return null;
        const cluster = clusterByCategoryMap.get(course.category);
        const contentType = pickContentType(recentTypesByCourse.get(course.courseSlug) || []);
        return {
          courseId: course.id,
          courseSlug: course.courseSlug,
          courseTitle: course.courseTitle,
          category: course.category,
          clusterId: cluster?._id || null,
          clusterName: cluster?.name || null,
          contentType,
          priorityTier: priority.tier,
          priorityScore: priority.score,
        };
      })
      .filter(Boolean);

    // Duplicate-check BEFORE any AI call — drop EXACT_DUPLICATE/HIGH risk.
    const survivors = [];
    for (const candidate of candidates) {
      const { duplicateScore, cannibalizationRisk, signals } = scoreDuplicateRisk(
        { title: `${candidate.courseTitle} ${candidate.contentType}`, slug: null, focusKeyword: null, clusterId: candidate.clusterId, searchIntent: null },
        corpus,
        settings.duplicateThresholds
      );
      if (cannibalizationRisk === "HIGH" || duplicateScore >= 95) {
        opportunitiesSkippedDuplicate += 1;
        continue;
      }
      survivors.push({ ...candidate, duplicateScore, cannibalizationRisk, duplicateSignals: signals });
    }

    if (survivors.length === 0) {
      run.status = "COMPLETE";
      run.finishedAt = new Date();
      run.coursesEvaluated = coursesEvaluated;
      run.opportunitiesCreated = 0;
      run.opportunitiesSkippedDuplicate = opportunitiesSkippedDuplicate;
      await run.save();
      return { run, opportunities: [] };
    }

    // ONE batched Claude call for all surviving candidates.
    const { text } = await trackedCallClaude({
      system: buildSystemPrompt(),
      prompt: buildUserPrompt({ candidates: survivors }),
      maxTokens: 4096,
      tier: "standard",
      callType: "opportunityCandidates",
      opportunityId: null,
    });
    const parsed = extractJson(text);
    const creativeFields = Array.isArray(parsed.opportunities) ? parsed.opportunities : [];

    const docsToInsert = survivors.map((candidate, i) => {
      const creative = creativeFields[i] || {};
      const courseRelevanceScore = Number.isFinite(Number(creative.courseRelevanceScore)) ? Number(creative.courseRelevanceScore) : 50;
      const businessIntentScore = Number.isFinite(Number(creative.businessIntentScore)) ? Number(creative.businessIntentScore) : 50;
      const seoOpportunityScore = 0; // M1 has no SEO gap analysis yet (that's M5)
      const overallScore = computeOverallScore({
        courseRelevanceScore,
        businessIntentScore,
        seoOpportunityScore,
        duplicateScore: candidate.duplicateScore,
        coursePriorityScore: candidate.priorityScore,
      });

      return {
        title: String(creative.title || `${candidate.courseTitle}: ${candidate.contentType}`).slice(0, 300),
        courseId: candidate.courseId,
        courseSlug: candidate.courseSlug,
        courseTitle: candidate.courseTitle,
        clusterId: candidate.clusterId,
        clusterName: candidate.clusterName,
        contentType: candidate.contentType,
        category: candidate.category,
        focusKeyword: creative.focusKeyword || null,
        secondaryKeywords: Array.isArray(creative.secondaryKeywords) ? creative.secondaryKeywords.slice(0, 10) : [],
        searchIntent: ["INFORMATIONAL", "EDUCATIONAL", "COMMERCIAL_INVESTIGATION", "TRANSACTIONAL", "NAVIGATIONAL"].includes(creative.searchIntent)
          ? creative.searchIntent
          : "INFORMATIONAL",
        businessIntentScore: Math.min(100, Math.max(0, businessIntentScore)),
        courseRelevanceScore: Math.min(100, Math.max(0, courseRelevanceScore)),
        targetAudience: creative.targetAudience || null,
        topicAngle: creative.topicAngle || null,
        recommendationReason: creative.recommendationReason || null,
        seoOpportunityScore,
        duplicateScore: candidate.duplicateScore,
        cannibalizationRisk: candidate.cannibalizationRisk,
        duplicateSignals: candidate.duplicateSignals,
        overallScore,
        status: "PLANNED",
        sourceInfo: { priorityTier: candidate.priorityTier, priorityScore: candidate.priorityScore, runId: run._id },
      };
    });

    const inserted = await ContentOpportunity.insertMany(docsToInsert, { ordered: false });
    opportunitiesCreated = inserted.length;

    run.status = "COMPLETE";
    run.finishedAt = new Date();
    run.coursesEvaluated = coursesEvaluated;
    run.opportunitiesCreated = opportunitiesCreated;
    run.opportunitiesSkippedDuplicate = opportunitiesSkippedDuplicate;
    await run.save();

    return { run, opportunities: inserted };
  } catch (err) {
    errors.push(err.message);
    run.status = "FAILED";
    run.finishedAt = new Date();
    run.coursesEvaluated = coursesEvaluated;
    run.opportunitiesCreated = opportunitiesCreated;
    run.opportunitiesSkippedDuplicate = opportunitiesSkippedDuplicate;
    run.errors = errors;
    await run.save();
    throw err;
  }
}
