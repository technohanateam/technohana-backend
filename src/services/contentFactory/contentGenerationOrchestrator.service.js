import ContentOpportunity from "../../models/contentOpportunity.model.js";
import ContentGenerationJob from "../../models/contentGenerationJob.model.js";
import ContentBrief from "../../models/contentBrief.model.js";
import { generateContentBrief } from "./contentBriefWriter.service.js";
import { writeArticle } from "./articleWriter.service.js";
import { writeSeoFields } from "./seoFieldWriter.service.js";
import { generateInternalLinks } from "./internalLinker.service.js";
import { generateImageConcept } from "./imagePromptWriter.service.js";
import { runQualityGate } from "./qualityGate.service.js";
import { reviseArticle } from "./revisionAgent.service.js";

// M3: QUALITY_GATE runs after IMAGE_PROMPT. It may internally trigger ONE
// automatic REVISION pass (tracked via opportunity.autoRevisionCount, capped
// at 1 here) — that sub-step isn't in STEP_ORDER since it's conditional, but
// gets its own entry appended to job.steps when it runs (see runSteps below).
const STEP_ORDER = ["BRIEF", "ARTICLE", "SEO", "LINKS", "IMAGE_PROMPT", "QUALITY_GATE"];

// Rough $/1K-token estimate table — public approximate pricing, NOT exact
// billing. Good enough for the budget-tracking UI (M4), not for invoicing.
const COST_PER_1K_TOKENS = {
  "claude-sonnet-4-6": { in: 0.003, out: 0.015 },
  "claude-haiku-4-5-20251001": { in: 0.0008, out: 0.004 },
  "claude-sonnet-5": { in: 0.003, out: 0.015 },
};
function estimateCostUsd(model, tokensIn, tokensOut) {
  const rates = COST_PER_1K_TOKENS[model] || COST_PER_1K_TOKENS["claude-sonnet-4-6"];
  return (tokensIn / 1000) * rates.in + (tokensOut / 1000) * rates.out;
}

function ensureSteps(job) {
  if (!job.steps || job.steps.length === 0) {
    job.steps = STEP_ORDER.map((name) => ({ name, status: "PENDING" }));
  }
  return job;
}

function getStep(job, name) {
  return job.steps.find((s) => s.name === name);
}

async function markStepRunning(job, name) {
  const step = getStep(job, name);
  step.status = "RUNNING";
  step.startedAt = new Date();
  step.error = null;
  await job.save();
}

async function markStepDone(job, name, { model, usage } = {}) {
  const step = getStep(job, name);
  step.status = "DONE";
  step.finishedAt = new Date();
  step.model = model || null;
  const tokensIn = usage?.input_tokens || 0;
  const tokensOut = usage?.output_tokens || 0;
  step.tokensIn = tokensIn;
  step.tokensOut = tokensOut;
  step.estimatedCostUsd = model ? estimateCostUsd(model, tokensIn, tokensOut) : 0;
  job.totalTokens += tokensIn + tokensOut;
  job.totalCostUsd += step.estimatedCostUsd;
  await job.save();
}

async function markStepFailed(job, name, error) {
  const step = getStep(job, name);
  step.status = "FAILED";
  step.finishedAt = new Date();
  step.error = String(error?.message || error).slice(0, 1000);
  await job.save();
}

function sumUsage(...usages) {
  return usages.reduce(
    (acc, u) => ({
      input_tokens: acc.input_tokens + (u?.input_tokens || 0),
      output_tokens: acc.output_tokens + (u?.output_tokens || 0),
    }),
    { input_tokens: 0, output_tokens: 0 }
  );
}

// Appends a new step entry to job.steps (used for REVISION, which isn't part
// of the fixed STEP_ORDER since it's conditional on the quality gate flagging
// the draft) and persists it.
async function appendStep(job, { name, model, usage, error, startedAt }) {
  const tokensIn = usage?.input_tokens || 0;
  const tokensOut = usage?.output_tokens || 0;
  const estimatedCostUsd = model ? estimateCostUsd(model, tokensIn, tokensOut) : 0;
  job.steps.push({
    name,
    status: error ? "FAILED" : "DONE",
    startedAt: startedAt || new Date(),
    finishedAt: new Date(),
    model: model || null,
    tokensIn,
    tokensOut,
    estimatedCostUsd,
    error: error || null,
  });
  job.totalTokens += tokensIn + tokensOut;
  job.totalCostUsd += estimatedCostUsd;
  await job.save();
}

// Runs STEP_ORDER starting at `fromIndex`, reusing already-persisted data for
// earlier steps (brief / articleDraft / imageConcept passed in) rather than
// regenerating them. Mutates and saves `job` and `opportunity` as it goes.
// Never throws — always returns a result object so callers can respond
// gracefully.
async function runSteps({ opportunity, job, fromIndex, brief, articleDraft, imageConcept }) {
  const startedAt = Date.now();
  // Set inside the QUALITY_GATE branch, consumed after the loop to decide the
  // final opportunity status (NEEDS_REVISION vs HUMAN_REVIEW).
  let qualityGateOutcome = null;

  for (let i = fromIndex; i < STEP_ORDER.length; i++) {
    const stepName = STEP_ORDER[i];
    try {
      await markStepRunning(job, stepName);

      if (stepName === "BRIEF") {
        const result = await generateContentBrief(opportunity);
        brief = result.brief;
        job.briefId = brief._id;
        await markStepDone(job, stepName, result);
      } else if (stepName === "ARTICLE") {
        const result = await writeArticle(brief, opportunity);
        articleDraft = result.articleDraft;
        await markStepDone(job, stepName, result);
      } else if (stepName === "SEO") {
        const result = await writeSeoFields(articleDraft, brief);
        articleDraft = { ...articleDraft, ...result.seoFields };
        await markStepDone(job, stepName, result);
      } else if (stepName === "LINKS") {
        const result = await generateInternalLinks(articleDraft, brief, opportunity);
        articleDraft = { ...articleDraft, content: result.content, suggestedInternalLinks: result.suggestedInternalLinks };
        await markStepDone(job, stepName, result);
      } else if (stepName === "IMAGE_PROMPT") {
        const result = await generateImageConcept(articleDraft, opportunity);
        imageConcept = result.imageConcept;
        await markStepDone(job, stepName, result);
      } else if (stepName === "QUALITY_GATE") {
        let gateResult = await runQualityGate(opportunity._id, articleDraft);

        // Automatic revision pass — capped at exactly 1 (guaranteed by the
        // `autoRevisionCount === 0` guard, never re-entered for this
        // opportunity's automatic pipeline again after this point).
        if (gateResult.flaggedForRevision && (opportunity.autoRevisionCount || 0) === 0) {
          const revisionStartedAt = new Date();
          const revisionResult = await reviseArticle(articleDraft, gateResult, brief);
          articleDraft = revisionResult.articleDraft;
          opportunity.autoRevisionCount = (opportunity.autoRevisionCount || 0) + 1;
          opportunity.articleDraft = articleDraft;
          await opportunity.save();

          await appendStep(job, {
            name: "REVISION",
            model: revisionResult.model,
            usage: revisionResult.usage,
            error: revisionResult.gaveUp ? revisionResult.note : null,
            startedAt: revisionStartedAt,
          });

          // Re-run the gate on the revised draft — this produces a SECOND
          // ContentQualityScore doc (generationAttempt auto-incremented
          // inside runQualityGate), so both attempts' flag history stays
          // visible to the review UI.
          gateResult = await runQualityGate(opportunity._id, articleDraft);
        }

        qualityGateOutcome = gateResult;

        const combinedUsage = sumUsage(
          gateResult.usage?.factChecker,
          gateResult.usage?.aiStyle,
          gateResult.usage?.qualityEvaluator
        );
        await markStepDone(job, stepName, {
          model: gateResult.models?.qualityEvaluator || gateResult.models?.factChecker || null,
          usage: combinedUsage,
        });
      }

      // Persist progress after each step so partial work is never lost even
      // if a later step fails.
      opportunity.articleDraft = articleDraft || opportunity.articleDraft;
      opportunity.imageConcept = imageConcept || opportunity.imageConcept;
      await opportunity.save();
    } catch (err) {
      console.error(`[content-factory] generation step ${stepName} failed for opportunity ${opportunity._id}:`, err.message);
      await markStepFailed(job, stepName, err);

      job.status = "FAILED";
      job.retryCount += 1;
      job.lastAttemptAt = new Date();
      job.durationMs = Date.now() - startedAt;
      await job.save();

      opportunity.status = "FAILED";
      opportunity.errorMessage = err.message;
      opportunity.retryCount += 1;
      opportunity.lastAttemptAt = new Date();
      await opportunity.save();

      return { success: false, failedStep: stepName, error: err.message, job, opportunity };
    }
  }

  job.status = "DONE";
  job.durationMs = Date.now() - startedAt;
  await job.save();

  // M3: if the quality gate is still flagged after the one automatic
  // revision pass (or was flagged and no revision was possible/attempted —
  // shouldn't happen given the branch above, but fail safe), route to
  // NEEDS_REVISION with the flag history visible via ContentQualityScore
  // docs rather than straight to HUMAN_REVIEW.
  if (qualityGateOutcome?.flaggedForRevision) {
    opportunity.status = "NEEDS_REVISION";
    opportunity.errorMessage = null;
    opportunity.humanRevisionNote = qualityGateOutcome.flagReasons?.length
      ? `Automatic quality gate flagged this draft after ${opportunity.autoRevisionCount > 0 ? "a revision pass" : "generation"}: ${qualityGateOutcome.flagReasons.join(" ")}`
      : opportunity.humanRevisionNote;
  } else {
    opportunity.status = "HUMAN_REVIEW";
    opportunity.errorMessage = null;
  }
  await opportunity.save();

  return { success: true, job, opportunity };
}

// Creates/loads a ContentGenerationJob and runs the full pipeline from the
// start. Never throws further up — returns a result object.
export async function runGenerationPipeline(opportunityId) {
  const opportunity = await ContentOpportunity.findById(opportunityId);
  if (!opportunity) return { success: false, error: "Opportunity not found" };

  opportunity.status = "GENERATING";
  opportunity.generationAttempts = (opportunity.generationAttempts || 0) + 1;
  // A full restart produces an entirely new article draft, so it gets its
  // own fresh automatic-revision allowance — the cap is "1 automatic pass
  // per generated draft", not "1 ever for this opportunity".
  opportunity.autoRevisionCount = 0;
  await opportunity.save();

  let job = await ContentGenerationJob.findOne({ opportunityId, status: { $in: ["QUEUED", "RUNNING"] } }).sort({ createdAt: -1 });
  if (!job) {
    job = new ContentGenerationJob({ opportunityId, status: "RUNNING", steps: [] });
  } else {
    job.status = "RUNNING";
  }
  ensureSteps(job);
  await job.save();

  return runSteps({ opportunity, job, fromIndex: 0 });
}

// Re-runs only from the failed step onward, reusing already-persisted
// brief/articleDraft where available — never regenerates steps that already
// succeeded, unless the step being retried is what's requested.
export async function retryFromStep(jobId, stepName) {
  const job = await ContentGenerationJob.findById(jobId);
  if (!job) return { success: false, error: "Job not found" };

  const opportunity = await ContentOpportunity.findById(job.opportunityId);
  if (!opportunity) return { success: false, error: "Opportunity not found" };

  ensureSteps(job);

  const targetName = stepName || job.steps.find((s) => s.status === "FAILED")?.name || STEP_ORDER[0];
  const fromIndex = STEP_ORDER.indexOf(targetName);
  if (fromIndex === -1) return { success: false, error: `Unknown step: ${targetName}` };

  // Reset the target step and any after it so re-running is visible in the
  // ledger; steps before it keep their DONE record untouched.
  job.steps.forEach((s) => {
    if (STEP_ORDER.indexOf(s.name) >= fromIndex) {
      s.status = "PENDING";
      s.error = null;
    }
  });
  job.status = "RUNNING";
  await job.save();

  opportunity.status = "GENERATING";
  opportunity.generationAttempts = (opportunity.generationAttempts || 0) + 1;
  await opportunity.save();

  const brief = fromIndex > 0 ? await ContentBrief.findOne({ opportunityId: opportunity._id }) : null;

  return runSteps({
    opportunity,
    job,
    fromIndex,
    brief,
    articleDraft: opportunity.articleDraft?.toObject ? opportunity.articleDraft.toObject() : opportunity.articleDraft,
    imageConcept: opportunity.imageConcept?.toObject ? opportunity.imageConcept.toObject() : opportunity.imageConcept,
  });
}
