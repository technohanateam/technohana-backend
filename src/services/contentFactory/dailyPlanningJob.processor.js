import ContentRun from "../../models/contentRun.model.js";
import ContentOpportunity from "../../models/contentOpportunity.model.js";
import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";
import { enforceBudgetOrPause } from "./budgetGuard.service.js";
import { refreshCoursePriorities } from "./coursePriorityAggregation.service.js";
import { researchTrends, buildCourseTrendScoreMap } from "./trendResearch.service.js";
import { analyzeContentGaps, buildCourseGapSignalMap } from "./contentGapAnalysis.service.js";
import { generateOpportunityCandidates } from "./contentStrategy.service.js";
import { enqueueGeneration } from "./contentGenerationQueue.js";

// The complete daily planning sequence (plan §30). contentFactoryQueue.js's
// Bull `.process()` calls this single export — the PAUSED short-circuit that
// used to live inline in the queue processor is absorbed here as step (1) so
// there's exactly one place the sequence lives.
export async function runDailyPlanningJob({ triggeredBy = "CRON" } = {}) {
  let settings = await getOrCreateContentFactorySettings();

  // (1) PAUSED check first — preserves M1's existing behavior: log a
  // skipped ContentRun and no-op, no AI spend at all.
  if (settings.automationStatus === "PAUSED") {
    const run = await ContentRun.create({
      runType: "PLANNING",
      triggeredBy,
      status: "COMPLETE",
      startedAt: new Date(),
      finishedAt: new Date(),
      coursesEvaluated: 0,
      opportunitiesCreated: 0,
      opportunitiesSkippedDuplicate: 0,
      articlesGenerated: 0,
      errors: ["skipped — automation paused"],
      dryRun: false,
      settingsSnapshot: settings.toObject ? settings.toObject() : settings,
    });
    return { skipped: true, reason: "automation paused", run };
  }

  // (2) Budget check before any AI-consuming phase.
  let budgetCheck = await enforceBudgetOrPause(settings);
  if (budgetCheck.paused) {
    const run = await ContentRun.create({
      runType: "PLANNING",
      triggeredBy,
      status: "COMPLETE",
      startedAt: new Date(),
      finishedAt: new Date(),
      coursesEvaluated: 0,
      opportunitiesCreated: 0,
      opportunitiesSkippedDuplicate: 0,
      articlesGenerated: 0,
      errors: [`skipped — ${budgetCheck.reason}`],
      dryRun: false,
      settingsSnapshot: budgetCheck.settings.toObject ? budgetCheck.settings.toObject() : budgetCheck.settings,
    });
    return { skipped: true, reason: budgetCheck.reason, run };
  }

  const result = { coursesEvaluated: 0, opportunitiesCreated: 0, articlesGenerated: 0, errors: [] };

  try {
    // (3) Refresh course priorities (stale-only).
    await refreshCoursePriorities({ force: false });

    // Re-check budget before the next AI-consuming phase — a mid-run breach
    // (e.g. another concurrent run) stops further spend here too.
    budgetCheck = await enforceBudgetOrPause(settings);
    if (budgetCheck.paused) {
      return { skipped: true, reason: budgetCheck.reason, partial: result };
    }

    // (4) Trend research — Milestone 5: real batched per-cluster
    // web_search_20260209 calls (capped by settings.maxDailyResearchCalls).
    const { trends } = await researchTrends();

    // (5) SEO/content-gap analysis — Milestone 5: real, deterministic read of
    // already-synced SeoGscMetric rows (no AI/network call).
    const { gaps } = await analyzeContentGaps();

    budgetCheck = await enforceBudgetOrPause(settings);
    if (budgetCheck.paused) {
      return { skipped: true, reason: budgetCheck.reason, partial: result };
    }

    // (6) Candidate generation — M1's existing strategy logic, now fed the
    // real per-course trendScore/seoOpportunityScore signals derived from (4)
    // and (5) so newly-created opportunities carry real scores instead of 0.
    const trendScoreMap = buildCourseTrendScoreMap(trends);
    const gapSignalsByCourse = buildCourseGapSignalMap(gaps);
    const { run, opportunities } = await generateOpportunityCandidates({
      dryRun: false,
      triggeredBy,
      trendScoreMap,
      gapSignalsByCourse,
    });
    result.coursesEvaluated = run.coursesEvaluated || 0;
    result.opportunitiesCreated = run.opportunitiesCreated || 0;

    // Lightweight summaries for the dashboard widgets (top few by signal
    // strength) — persisted onto this ContentRun so the frontend can read
    // them off the existing GET /runs fetch with no new endpoint.
    run.trendsSummary = trends
      .slice()
      .sort((a, b) => (b.matchedCourses?.length || 0) - (a.matchedCourses?.length || 0))
      .slice(0, 5)
      .map((t) => ({ topic: t.topic, summary: t.summary, cluster: t.cluster, matchedCourseCount: t.matchedCourses?.length || 0 }));
    run.gapsSummary = gaps
      .slice()
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5)
      .map((g) => ({ query: g.query, impressions: g.impressions, ctr: g.ctr, suggestedAngle: g.suggestedAngle }));

    // (7) Optional auto-generation of top-N newly-created PLANNED
    // opportunities. autoGenerateArticles defaults false. Even when true,
    // this ONLY enqueues generation jobs — the generation pipeline
    // (contentGenerationOrchestrator.service.js) always lands articles in
    // HUMAN_REVIEW/NEEDS_REVISION, never auto-approves or auto-publishes.
    settings = await getOrCreateContentFactorySettings();
    if (settings.autoGenerateArticles === true && opportunities.length > 0) {
      budgetCheck = await enforceBudgetOrPause(settings);
      if (!budgetCheck.paused) {
        const maxArticles = settings.maxDailyArticles || 8;
        const topOpportunities = [...opportunities]
          .filter((o) => o.status === "PLANNED")
          .sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0))
          .slice(0, maxArticles);

        for (const opp of topOpportunities) {
          // eslint-disable-next-line no-await-in-loop
          const midRunBudget = await enforceBudgetOrPause(await getOrCreateContentFactorySettings());
          if (midRunBudget.paused) {
            result.errors.push(`auto-generation stopped early — ${midRunBudget.reason}`);
            break;
          }
          try {
            // eslint-disable-next-line no-await-in-loop
            await ContentOpportunity.updateOne({ _id: opp._id }, { $set: { status: "SELECTED" } });
            // eslint-disable-next-line no-await-in-loop
            await enqueueGeneration(opp._id);
            result.articlesGenerated += 1;
          } catch (err) {
            result.errors.push(`enqueue failed for ${opp._id}: ${err.message}`);
          }
        }
      } else {
        result.errors.push(`auto-generation skipped — ${budgetCheck.reason}`);
      }
    }

    // (8) Final ContentRun counts.
    run.articlesGenerated = result.articlesGenerated;
    if (result.errors.length) run.errors = [...(run.errors || []), ...result.errors];
    await run.save();

    return { skipped: false, run, ...result };
  } catch (err) {
    console.error("[content-factory] daily planning job failed:", err.message);
    // generateOpportunityCandidates() already persisted a FAILED ContentRun
    // with the real coursesEvaluated/opportunitiesCreated counts before
    // rethrowing (see err.contentRun) — update that one instead of creating
    // a second, zeroed-out record for the same failure.
    let run = err.contentRun;
    if (run) {
      run.articlesGenerated = result.articlesGenerated;
      run.errors = [...(run.errors || []), ...result.errors];
      await run.save();
    } else {
      run = await ContentRun.create({
        runType: "PLANNING",
        triggeredBy,
        status: "FAILED",
        startedAt: new Date(),
        finishedAt: new Date(),
        coursesEvaluated: result.coursesEvaluated,
        opportunitiesCreated: result.opportunitiesCreated,
        articlesGenerated: result.articlesGenerated,
        errors: [...result.errors, err.message],
        dryRun: false,
      });
    }
    return { skipped: false, failed: true, error: err.message, run };
  }
}
