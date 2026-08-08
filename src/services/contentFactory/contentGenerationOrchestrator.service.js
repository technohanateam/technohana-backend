import ContentOpportunity from "../../models/contentOpportunity.model.js";
import ContentGenerationJob from "../../models/contentGenerationJob.model.js";
import ContentBrief from "../../models/contentBrief.model.js";
import { generateContentBrief } from "./contentBriefWriter.service.js";
import { writeArticle } from "./articleWriter.service.js";
import { writeSeoFields } from "./seoFieldWriter.service.js";
import { generateInternalLinks } from "./internalLinker.service.js";
import { generateImageConcept } from "./imagePromptWriter.service.js";

// M2 pipeline order. QUALITY_GATE exists on the ContentGenerationJob schema
// for M3 forward-compat but is never run/populated here.
const STEP_ORDER = ["BRIEF", "ARTICLE", "SEO", "LINKS", "IMAGE_PROMPT"];

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

// Runs STEP_ORDER starting at `fromIndex`, reusing already-persisted data for
// earlier steps (brief / articleDraft / imageConcept passed in) rather than
// regenerating them. Mutates and saves `job` and `opportunity` as it goes.
// Never throws — always returns a result object so callers can respond
// gracefully.
async function runSteps({ opportunity, job, fromIndex, brief, articleDraft, imageConcept }) {
  const startedAt = Date.now();

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

  // Skip AI_REVIEW/QUALITY_GATE — M3 will insert a QUALITY_GATE step here
  // that may redirect to NEEDS_REVISION instead of going straight to
  // HUMAN_REVIEW.
  opportunity.status = "HUMAN_REVIEW";
  opportunity.errorMessage = null;
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
