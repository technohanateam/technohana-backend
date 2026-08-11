import ContentQualityScore from "../../models/contentQualityScore.model.js";
import ContentBrief from "../../models/contentBrief.model.js";
import ContentOpportunity from "../../models/contentOpportunity.model.js";
import { getOrCreateContentFactorySettings } from "../../models/contentFactorySettings.model.js";
import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildQualityEvaluatorPrompt } from "../../prompts/contentFactory/qualityEvaluator.prompt.js";
import { buildFactCheckerPrompt, parseFactCheckResponse } from "./factChecker.service.js";
import { buildAiStyleEvaluatorPrompt, parseAiStyleResponse } from "./aiStyleEvaluator.service.js";
import { META_TITLE_RANGE, META_DESCRIPTION_RANGE } from "./seoThresholds.js";

// Weighted-average composition of overallScore. aiStyleRiskScore is inverted
// (100 - score) since it's "lower is better", everything else is "higher is
// better" 0-100. Weights below are a documented editorial judgment call, not
// derived from data:
//   factualityScore            15  — accuracy is the highest-stakes dimension
//   seoScore                   10
//   originalityScore           10
//   courseRelevanceScore       10
//   readabilityScore            8
//   searchIntentAlignmentScore  8
//   specificityScore            8
//   originalInsightScore        8
//   internalLinksScore          6
//   ctaRelevanceScore           6
//   editorialQualityScore       6
//   aiStyleRiskScore (inverted) 5  — also gates independently, see below
// Sum = 100.
const WEIGHTS = {
  factualityScore: 15,
  seoScore: 10,
  originalityScore: 10,
  courseRelevanceScore: 10,
  readabilityScore: 8,
  searchIntentAlignmentScore: 8,
  specificityScore: 8,
  originalInsightScore: 8,
  internalLinksScore: 6,
  ctaRelevanceScore: 6,
  editorialQualityScore: 6,
  aiStyleRiskScore: 5,
};
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

function clamp0to100(n) {
  const v = Number(n) || 0;
  return Math.max(0, Math.min(100, v));
}

// PURE function — no DB/network calls. `scores` holds the raw dimension
// scores (0-100 each, aiStyleRiskScore included as-is, NOT pre-inverted).
// `settings` = { aiStyleRiskThreshold, overallScoreFloor }. Unit-testable
// with plain objects.
export function computeQualityGateResult(scores, settings) {
  const aiStyleRiskThreshold = Number.isFinite(settings?.aiStyleRiskThreshold) ? settings.aiStyleRiskThreshold : 30;
  const overallScoreFloor = Number.isFinite(settings?.overallScoreFloor) ? settings.overallScoreFloor : 60;

  let weightedSum = 0;
  for (const [dimension, weight] of Object.entries(WEIGHTS)) {
    const raw = clamp0to100(scores?.[dimension]);
    const value = dimension === "aiStyleRiskScore" ? 100 - raw : raw;
    weightedSum += value * weight;
  }
  const overallScore = Math.round((weightedSum / TOTAL_WEIGHT) * 100) / 100;

  const aiStyleRiskScore = clamp0to100(scores?.aiStyleRiskScore);
  const factualityScore = clamp0to100(scores?.factualityScore);

  const flagReasons = [];
  if (aiStyleRiskScore > aiStyleRiskThreshold) {
    flagReasons.push(`AI-style risk score (${aiStyleRiskScore}) exceeds the threshold of ${aiStyleRiskThreshold}.`);
  }
  if (overallScore < overallScoreFloor) {
    flagReasons.push(`Overall quality score (${overallScore}) is below the floor of ${overallScoreFloor}.`);
  }
  if (factualityScore > 0 && factualityScore < 50) {
    flagReasons.push(`Factuality score (${factualityScore}) is low — review fact-check findings.`);
  }
  if (Array.isArray(scores?.aiStyleFlagReasons)) {
    for (const reason of scores.aiStyleFlagReasons) {
      if (reason) flagReasons.push(reason);
    }
  }

  const flaggedForRevision = aiStyleRiskScore > aiStyleRiskThreshold || overallScore < overallScoreFloor;

  return { overallScore, flaggedForRevision, flagReasons };
}

// Deterministic — reuses the same 50-60/140-160 char thresholds the editor UI
// checks (seoThresholds.js), rather than asking the AI to re-judge something
// computable. Mirrors AdminBlogs.jsx's SEO checklist shape (5 checks x 20pts),
// with "featured image set" swapped for "tags present" since the image is
// generated as a separate concept-only step, not part of articleDraft.
function computeSeoScoreDeterministic(articleDraft) {
  const titleLen = (articleDraft?.metaTitle || "").length;
  const descLen = (articleDraft?.metaDescription || "").length;
  const checks = [
    Boolean(articleDraft?.focusKeyword),
    titleLen >= META_TITLE_RANGE.min && titleLen <= META_TITLE_RANGE.max,
    descLen >= META_DESCRIPTION_RANGE.min && descLen <= META_DESCRIPTION_RANGE.max,
    Boolean(articleDraft?.excerpt),
    Array.isArray(articleDraft?.tags) && articleDraft.tags.length >= 3,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// Target ranges mirror internalLinker.service.js's MIN/MAX constants
// (2-5 course links, 1-4 blog links). Full score when both are in range,
// partial credit for partially in range, 0 when both are empty.
function computeInternalLinksScoreDeterministic(articleDraft) {
  const courseCount = articleDraft?.suggestedInternalLinks?.courses?.length || 0;
  const blogCount = articleDraft?.suggestedInternalLinks?.blogs?.length || 0;
  const courseOk = courseCount >= 2 && courseCount <= 5;
  const blogOk = blogCount >= 1 && blogCount <= 4;
  if (courseOk && blogOk) return 100;
  if (courseOk || blogOk) return 55;
  if (courseCount > 0 || blogCount > 0) return 30;
  return 0;
}

function computeFactualityScore(findings) {
  if (!findings || findings.length === 0) {
    // No checkable factual/current claims found — neutral-good default
    // rather than penalizing an article that simply didn't make risky claims.
    return 80;
  }
  const verifiableCount = findings.filter((f) => f.verifiable).length;
  return Math.round((verifiableCount / findings.length) * 100);
}

// Builds the 3 prompts the QUALITY_GATE step needs (fact-check, AI-style,
// quality-eval) so they can be shown together for one manual paste-back
// round trip, per the pause-once-per-STEP design.
export async function buildQualityGatePrompts(opportunityId, articleDraft) {
  const [opportunity, brief] = await Promise.all([
    ContentOpportunity.findById(opportunityId).lean(),
    ContentBrief.findOne({ opportunityId }).lean(),
  ]);
  if (!opportunity) throw new Error("Opportunity not found for quality gate");

  return {
    factCheck: buildFactCheckerPrompt({ articleDraft }),
    aiStyle: buildAiStyleEvaluatorPrompt({ articleContent: articleDraft?.content }),
    qualityEval: buildQualityEvaluatorPrompt({ articleDraft, brief, opportunity }),
  };
}

// Orchestrating function — parses the 3 manually-pasted responses, does the
// deterministic scoring, calls the pure computeQualityGateResult() above,
// persists a ContentQualityScore doc.
export async function resolveQualityGate(opportunityId, articleDraft, { factCheckText, aiStyleText, qualityEvalText }) {
  const settings = await getOrCreateContentFactorySettings();
  const priorScoreCount = await ContentQualityScore.countDocuments({ opportunityId });

  const seoScore = computeSeoScoreDeterministic(articleDraft);
  const internalLinksScore = computeInternalLinksScoreDeterministic(articleDraft);

  const factCheckResult = parseFactCheckResponse(factCheckText);
  const aiStyleResult = (() => {
    try {
      return parseAiStyleResponse(aiStyleText);
    } catch (err) {
      return { aiStyleRiskScore: 0, flagReasons: [], error: err.message };
    }
  })();
  const qe = (() => {
    try {
      return parseModelJson(qualityEvalText);
    } catch (err) {
      throw new Error(`Failed to parse quality evaluator AI response: ${err.message}`);
    }
  })();

  const factualityScore = computeFactualityScore(factCheckResult.findings);

  const scores = {
    seoScore,
    originalityScore: clamp0to100(qe.originalityScore),
    readabilityScore: clamp0to100(qe.readabilityScore),
    courseRelevanceScore: clamp0to100(qe.courseRelevanceScore),
    searchIntentAlignmentScore: clamp0to100(qe.searchIntentAlignmentScore),
    internalLinksScore,
    factualityScore,
    ctaRelevanceScore: clamp0to100(qe.ctaRelevanceScore),
    specificityScore: clamp0to100(qe.specificityScore),
    originalInsightScore: clamp0to100(qe.originalInsightScore),
    editorialQualityScore: clamp0to100(qe.editorialQualityScore),
    aiStyleRiskScore: clamp0to100(aiStyleResult.aiStyleRiskScore),
    aiStyleFlagReasons: aiStyleResult.flagReasons || [],
  };

  const gateResult = computeQualityGateResult(scores, {
    aiStyleRiskThreshold: settings.aiStyleRiskThreshold,
    overallScoreFloor: settings.overallScoreFloor,
  });

  const qualityScoreDoc = await ContentQualityScore.create({
    opportunityId,
    generationAttempt: priorScoreCount + 1,
    seoScore,
    originalityScore: scores.originalityScore,
    readabilityScore: scores.readabilityScore,
    courseRelevanceScore: scores.courseRelevanceScore,
    searchIntentAlignmentScore: scores.searchIntentAlignmentScore,
    internalLinksScore,
    factualityScore,
    ctaRelevanceScore: scores.ctaRelevanceScore,
    specificityScore: scores.specificityScore,
    originalInsightScore: scores.originalInsightScore,
    editorialQualityScore: scores.editorialQualityScore,
    aiStyleRiskScore: scores.aiStyleRiskScore,
    overallScore: gateResult.overallScore,
    flaggedForRevision: gateResult.flaggedForRevision,
    flagReasons: gateResult.flagReasons,
    factCheckFindings: factCheckResult.findings || [],
    evaluatedByModel: null,
    evaluationErrors: {
      factChecker: factCheckResult.error || null,
      aiStyle: aiStyleResult.error || null,
    },
  });

  return {
    overallScore: gateResult.overallScore,
    flaggedForRevision: gateResult.flaggedForRevision,
    flagReasons: gateResult.flagReasons,
    factCheckFindings: factCheckResult.findings || [],
    qualityScoreDoc,
  };
}
