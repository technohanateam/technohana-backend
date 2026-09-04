import AdCreativeOpportunity from "../../models/adCreativeFactory/adCreativeOpportunity.model.js";
import AdCreativeGenerationJob from "../../models/adCreativeFactory/adCreativeGenerationJob.model.js";
import { getOrCreateAdCreativeFactorySettings } from "../../models/adCreativeFactory/adCreativeFactorySettings.model.js";
import { buildAdBriefPrompt, parseAdBriefResponse, generateAdBriefViaApi, buildAdCopyDraftPrompt, parseAdCopyDraftResponse } from "./adCopyWriter.service.js";
import { applyPlatformFit, scanComplianceBlocklist, buildBrandVoiceEvalPrompt, parseBrandVoiceResponse, computeAdComplianceGateResult } from "./platformComplianceGate.service.js";
import { buildRevisionPrompt, parseRevisionResponse } from "./adCreativeRevisionAgent.service.js";

// PLATFORM_FIT is deterministic (no AI call, never pauses) — it's in
// STEP_ORDER for ledger visibility, resolved synchronously inside runSteps.
const STEP_ORDER = ["BRIEF", "COPY_DRAFT", "PLATFORM_FIT", "COMPLIANCE_GATE"];

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

async function markStepDone(job, name) {
  const step = getStep(job, name);
  step.status = "DONE";
  step.finishedAt = new Date();
  await job.save();
}

async function markStepFailed(job, name, error) {
  const step = getStep(job, name);
  step.status = "FAILED";
  step.finishedAt = new Date();
  step.error = String(error?.message || error).slice(0, 1000);
  await job.save();
}

async function appendStep(job, { name, error, startedAt }) {
  job.steps.push({
    name,
    status: error ? "FAILED" : "DONE",
    startedAt: startedAt || new Date(),
    finishedAt: new Date(),
    error: error || null,
  });
  await job.save();
}

// Pauses the job/opportunity at `stepName` for a manual Claude Pro round
// trip. Never a failure — job.status becomes AWAITING_INPUT, not FAILED.
async function pauseForInput(job, opportunity, stepName, prompts, kind = null) {
  job.pendingStep = stepName;
  job.pendingPrompts = prompts;
  job.pendingKind = kind;
  job.status = "AWAITING_INPUT";
  await markStepRunning(job, stepName);
  await job.save();

  opportunity.status = "AWAITING_INPUT";
  await opportunity.save();

  return { success: true, awaitingInput: true, pendingStep: stepName, job, opportunity };
}

// Runs STEP_ORDER starting at `fromIndex`. Mutates and saves `job` and
// `opportunity` as it goes. Never throws — always returns a result object.
// `skipBrandVoice` lets an admin bypass the optional brand-voice eval for
// zero-API-usage generation.
async function runSteps({ opportunity, job, fromIndex, brief, creativeDraft, resume, briefMode, skipBrandVoice }) {
  let complianceOutcome = null;

  for (let i = fromIndex; i < STEP_ORDER.length; i++) {
    const stepName = STEP_ORDER[i];
    const resumeForThisStep = resume && resume.stepName === stepName ? resume : null;

    try {
      if (stepName === "BRIEF") {
        if (!resumeForThisStep) {
          if (briefMode === "api") {
            await markStepRunning(job, stepName);
            try {
              const apiResult = await generateAdBriefViaApi({ opportunity });
              brief = apiResult.brief;
              opportunity.brief = brief;
              const step = getStep(job, stepName);
              step.model = apiResult.model || null;
              step.tokensIn = apiResult.usage?.input_tokens || 0;
              step.tokensOut = apiResult.usage?.output_tokens || 0;
              const INPUT_COST = 3 / 1_000_000;
              const OUTPUT_COST = 15 / 1_000_000;
              step.estimatedCostUsd = +(step.tokensIn * INPUT_COST + step.tokensOut * OUTPUT_COST).toFixed(6);
              await markStepDone(job, stepName);
            } catch (apiBriefErr) {
              console.warn(`[ad-creative-factory] API brief failed for ${opportunity._id}, falling back to manual:`, apiBriefErr.message);
              const step = getStep(job, stepName);
              step.status = "PENDING";
              step.startedAt = null;
              step.error = null;
              await job.save();
              const { system, prompt } = buildAdBriefPrompt(opportunity);
              return pauseForInput(job, opportunity, stepName, [{ label: "Ad creative brief", system, prompt }]);
            }
          } else {
            const { system, prompt } = buildAdBriefPrompt(opportunity);
            return pauseForInput(job, opportunity, stepName, [{ label: "Ad creative brief", system, prompt }]);
          }
        } else {
          brief = parseAdBriefResponse(resumeForThisStep.responses[0]?.text);
          opportunity.brief = brief;
          await markStepDone(job, stepName);
        }
      } else if (stepName === "COPY_DRAFT") {
        if (!resumeForThisStep) {
          const settings = await getOrCreateAdCreativeFactorySettings();
          const { system, prompt } = buildAdCopyDraftPrompt({ brief, opportunity, settings });
          return pauseForInput(job, opportunity, stepName, [{ label: "Ad copy variants", system, prompt }]);
        }
        creativeDraft = parseAdCopyDraftResponse(resumeForThisStep.responses[0]?.text, opportunity);
        await markStepDone(job, stepName);
      } else if (stepName === "PLATFORM_FIT") {
        // Deterministic, no AI call, never pauses.
        const settings = await getOrCreateAdCreativeFactorySettings();
        const { creativeDraft: fitted } = applyPlatformFit(creativeDraft, settings);
        creativeDraft = fitted;
        await markStepDone(job, stepName);
      } else if (stepName === "COMPLIANCE_GATE") {
        if (!resumeForThisStep) {
          const settings = await getOrCreateAdCreativeFactorySettings();
          const blocklistHits = scanComplianceBlocklist(creativeDraft, settings);
          const { oversized } = applyPlatformFit(creativeDraft, settings);

          if (skipBrandVoice) {
            const gateResult = computeAdComplianceGateResult({ blocklistHits, oversized, brandVoiceResult: null }, settings);
            job.pendingComplianceResult = null;
            complianceOutcome = gateResult;
            opportunity.complianceFlags = gateResult.flagReasons;
            if (gateResult.flaggedForRevision && (opportunity.autoRevisionCount || 0) === 0) {
              const { system, prompt } = buildRevisionPrompt({ creativeDraft, flagReasons: gateResult.flagReasons, humanNote: null, stronger: false });
              job.pendingComplianceResult = gateResult;
              return pauseForInput(job, opportunity, stepName, [{ label: "Automatic revision (flagged draft)", system, prompt }], "REVISION");
            }
            await markStepDone(job, stepName);
          } else {
            job.pendingComplianceResult = { blocklistHits, oversized };
            const { system, prompt } = buildBrandVoiceEvalPrompt({ creativeDraft });
            return pauseForInput(job, opportunity, stepName, [{ label: "Brand-voice evaluation (optional — skip via skipBrandVoice)", system, prompt }], "BRAND_VOICE");
          }
        } else if (resumeForThisStep.kind === "BRAND_VOICE") {
          const settings = await getOrCreateAdCreativeFactorySettings();
          const { blocklistHits, oversized } = job.pendingComplianceResult || {};
          const brandVoiceResult = parseBrandVoiceResponse(resumeForThisStep.responses[0]?.text);
          const gateResult = computeAdComplianceGateResult({ blocklistHits: blocklistHits || [], oversized: oversized || [], brandVoiceResult }, settings);
          job.pendingComplianceResult = null;
          opportunity.complianceFlags = gateResult.flagReasons;

          if (gateResult.flaggedForRevision && (opportunity.autoRevisionCount || 0) === 0) {
            const { system, prompt } = buildRevisionPrompt({ creativeDraft, flagReasons: gateResult.flagReasons, humanNote: null, stronger: false });
            job.pendingComplianceResult = gateResult;
            return pauseForInput(job, opportunity, stepName, [{ label: "Automatic revision (flagged draft)", system, prompt }], "REVISION");
          }
          complianceOutcome = gateResult;
          await markStepDone(job, stepName);
        } else if (resumeForThisStep.kind === "REVISION" || resumeForThisStep.kind === "REVISION_STRONGER") {
          const revisionStartedAt = new Date();
          const priorGateResult = job.pendingComplianceResult;
          const revisionText = resumeForThisStep.responses[0]?.text;
          const fallbackPlatform = opportunity.platform === "BOTH" ? "META" : opportunity.platform;

          if (resumeForThisStep.kind === "REVISION") {
            const first = parseRevisionResponse(revisionText, creativeDraft, fallbackPlatform);
            if (first.tooSimilar) {
              const { system, prompt } = buildRevisionPrompt({ creativeDraft, flagReasons: priorGateResult?.flagReasons, humanNote: null, stronger: true });
              job.pendingFirstRevision = { revised: first.revised, similarity: first.similarity };
              return pauseForInput(job, opportunity, stepName, [{ label: "Automatic revision (stronger rewrite requested)", system, prompt }], "REVISION_STRONGER");
            }
            creativeDraft = first.revised;
          } else {
            const first = job.pendingFirstRevision;
            const second = parseRevisionResponse(revisionText, creativeDraft, fallbackPlatform);
            creativeDraft = first && second.similarity > first.similarity ? first.revised : second.revised;
            job.pendingFirstRevision = null;
          }

          opportunity.autoRevisionCount = (opportunity.autoRevisionCount || 0) + 1;
          opportunity.creativeDraft = creativeDraft;
          await opportunity.save();

          await appendStep(job, { name: "REVISION", error: null, startedAt: revisionStartedAt });

          job.pendingComplianceResult = null;
          // Re-run the deterministic checks on the revised draft, then re-run
          // the same optional-brand-voice-or-not path this generation chose.
          const settings = await getOrCreateAdCreativeFactorySettings();
          const blocklistHits = scanComplianceBlocklist(creativeDraft, settings);
          const { creativeDraft: fitted, oversized } = applyPlatformFit(creativeDraft, settings);
          creativeDraft = fitted;

          if (skipBrandVoice) {
            const gateResult = computeAdComplianceGateResult({ blocklistHits, oversized, brandVoiceResult: null }, settings);
            complianceOutcome = gateResult;
            opportunity.complianceFlags = gateResult.flagReasons;
            await markStepDone(job, stepName);
          } else {
            job.pendingComplianceResult = { blocklistHits, oversized };
            const { system, prompt } = buildBrandVoiceEvalPrompt({ creativeDraft });
            return pauseForInput(job, opportunity, stepName, [{ label: "Brand-voice evaluation (post-revision)", system, prompt }], "BRAND_VOICE");
          }
        }
      }

      opportunity.creativeDraft = creativeDraft || opportunity.creativeDraft;
      await opportunity.save();
    } catch (err) {
      console.error(`[ad-creative-factory] generation step ${stepName} failed for opportunity ${opportunity._id}:`, err.message);
      await markStepFailed(job, stepName, err);

      job.status = "FAILED";
      job.pendingStep = null;
      job.pendingPrompts = [];
      job.retryCount += 1;
      job.lastAttemptAt = new Date();
      await job.save();

      let failedOpportunity = opportunity;
      try {
        opportunity.status = "FAILED";
        opportunity.errorMessage = err.message;
        opportunity.retryCount += 1;
        opportunity.lastAttemptAt = new Date();
        await opportunity.save();
      } catch (saveErr) {
        console.error(`[ad-creative-factory] failed to persist FAILED status for opportunity ${opportunity._id}, retrying with a fresh doc:`, saveErr.message);
        failedOpportunity = await AdCreativeOpportunity.findById(opportunity._id);
        if (failedOpportunity) {
          failedOpportunity.status = "FAILED";
          failedOpportunity.errorMessage = err.message;
          failedOpportunity.retryCount += 1;
          failedOpportunity.lastAttemptAt = new Date();
          await failedOpportunity.save();
        }
      }

      return { success: false, failedStep: stepName, error: err.message, job, opportunity: failedOpportunity };
    }
  }

  job.status = "DONE";
  job.pendingStep = null;
  job.pendingPrompts = [];
  await job.save();

  if (complianceOutcome?.flaggedForRevision) {
    opportunity.status = "NEEDS_REVISION";
    opportunity.errorMessage = null;
    opportunity.humanRevisionNote = complianceOutcome.flagReasons?.length
      ? `Automatic compliance gate flagged this draft after ${opportunity.autoRevisionCount > 0 ? "a revision pass" : "generation"}: ${complianceOutcome.flagReasons.join(" ")}`
      : opportunity.humanRevisionNote;
  } else {
    opportunity.status = "HUMAN_REVIEW";
    opportunity.errorMessage = null;
  }
  await opportunity.save();

  return { success: true, job, opportunity };
}

// Creates/loads an AdCreativeGenerationJob and runs the full pipeline from
// the start. Never throws further up — returns a result object.
export async function runGenerationPipeline(opportunityId, jobId, { briefMode, skipBrandVoice } = {}) {
  const opportunity = await AdCreativeOpportunity.findById(opportunityId);
  if (!opportunity) return { success: false, error: "Opportunity not found" };

  try {
    opportunity.status = "GENERATING";
    opportunity.generationAttempts = (opportunity.generationAttempts || 0) + 1;
    opportunity.autoRevisionCount = 0;
    await opportunity.save();

    let job = jobId ? await AdCreativeGenerationJob.findById(jobId) : null;
    if (!job) {
      job = await AdCreativeGenerationJob.findOne({ opportunityId, status: { $in: ["QUEUED", "RUNNING"] } }).sort({ createdAt: -1 });
    }
    if (!job) {
      job = new AdCreativeGenerationJob({ opportunityId, status: "RUNNING", steps: [] });
    } else {
      job.status = "RUNNING";
    }
    ensureSteps(job);
    // Remembered on the job so a later resumeStep still honours it — see the
    // field's comment on the model.
    job.skipBrandVoice = Boolean(skipBrandVoice);
    await job.save();

    return runSteps({ opportunity, job, fromIndex: 0, briefMode, skipBrandVoice });
  } catch (err) {
    console.error(`[ad-creative-factory] generation setup failed for opportunity ${opportunity._id}:`, err.message);
    opportunity.status = "FAILED";
    opportunity.errorMessage = err.message;
    opportunity.retryCount = (opportunity.retryCount || 0) + 1;
    opportunity.lastAttemptAt = new Date();
    await opportunity.save();
    return { success: false, failedStep: "SETUP", error: err.message, opportunity };
  }
}

// Resumes a paused (AWAITING_INPUT) job with the admin's pasted response(s)
// for job.pendingStep. `responses` must be an array aligned with
// job.pendingPrompts (same order/length) — [{ label, text }]. Pass
// `skipBrandVoice: true` in `resume` when resuming a BRAND_VOICE pause with
// no response — instead call resumeStep with skipBrandVoice at the top level.
export async function resumeStep(jobId, { responses, skipBrandVoice } = {}) {
  const job = await AdCreativeGenerationJob.findById(jobId);
  if (!job) return { success: false, error: "Job not found" };
  if (job.status !== "AWAITING_INPUT" || !job.pendingStep) {
    return { success: false, error: `Job is not awaiting input (status: ${job.status})` };
  }

  const opportunity = await AdCreativeOpportunity.findById(job.opportunityId);
  if (!opportunity) return { success: false, error: "Opportunity not found" };

  const stepName = job.pendingStep;
  const fromIndex = STEP_ORDER.indexOf(stepName);

  // Either the caller skips this one pause, or the whole job was started
  // with skipBrandVoice.
  const skipsBrandVoice = Boolean(skipBrandVoice) || Boolean(job.skipBrandVoice);

  // Skipping the optional BRAND_VOICE pause: resolve the compliance gate
  // with the deterministic checks only, no pasted response needed.
  if (job.pendingKind === "BRAND_VOICE" && skipsBrandVoice) {
    const settings = await getOrCreateAdCreativeFactorySettings();
    const { blocklistHits, oversized } = job.pendingComplianceResult || {};
    const gateResult = computeAdComplianceGateResult({ blocklistHits: blocklistHits || [], oversized: oversized || [], brandVoiceResult: null }, settings);
    job.pendingComplianceResult = null;
    opportunity.complianceFlags = gateResult.flagReasons;

    job.status = "RUNNING";
    job.pendingPrompts = [];
    job.pendingKind = null;
    await job.save();

    if (gateResult.flaggedForRevision && (opportunity.autoRevisionCount || 0) === 0) {
      const creativeDraft = opportunity.creativeDraft?.toObject ? opportunity.creativeDraft.toObject() : opportunity.creativeDraft;
      const { system, prompt } = buildRevisionPrompt({ creativeDraft, flagReasons: gateResult.flagReasons, humanNote: null, stronger: false });
      job.pendingComplianceResult = gateResult;
      return pauseForInput(job, opportunity, stepName, [{ label: "Automatic revision (flagged draft)", system, prompt }], "REVISION");
    }

    await markStepDone(job, stepName);
    job.status = "DONE";
    job.pendingStep = null;
    job.pendingPrompts = [];
    await job.save();

    opportunity.status = "HUMAN_REVIEW";
    opportunity.errorMessage = null;
    await opportunity.save();
    return { success: true, job, opportunity };
  }

  const expectedCount = job.pendingPrompts.length;
  const providedResponses = Array.isArray(responses) ? responses : [];
  if (providedResponses.length !== expectedCount || providedResponses.some((r) => !r?.text || !String(r.text).trim())) {
    return { success: false, error: `Expected ${expectedCount} non-empty response(s), got ${providedResponses.length}.` };
  }

  const brief = opportunity.brief?.toObject ? opportunity.brief.toObject() : opportunity.brief;
  const creativeDraft = opportunity.creativeDraft?.toObject ? opportunity.creativeDraft.toObject() : opportunity.creativeDraft;

  const resume = { stepName, kind: job.pendingKind, responses: providedResponses };

  job.status = "RUNNING";
  job.pendingPrompts = [];
  job.pendingKind = null;
  await job.save();

  return runSteps({ opportunity, job, fromIndex, brief, creativeDraft, resume, skipBrandVoice: skipsBrandVoice });
}

// Re-runs only from the failed step onward.
export async function retryFromStep(jobId, stepName) {
  const job = await AdCreativeGenerationJob.findById(jobId);
  if (!job) return { success: false, error: "Job not found" };

  const opportunity = await AdCreativeOpportunity.findById(job.opportunityId);
  if (!opportunity) return { success: false, error: "Opportunity not found" };

  ensureSteps(job);

  const targetName = stepName || job.steps.find((s) => s.status === "FAILED")?.name || STEP_ORDER[0];
  const fromIndex = STEP_ORDER.indexOf(targetName);
  if (fromIndex === -1) return { success: false, error: `Unknown step: ${targetName}` };

  try {
    const copyDraftIndex = STEP_ORDER.indexOf("COPY_DRAFT");
    const complianceGateIndex = STEP_ORDER.indexOf("COMPLIANCE_GATE");

    job.steps = job.steps.filter((s) => !(s.name === "REVISION" && fromIndex <= complianceGateIndex));
    job.steps.forEach((s) => {
      if (STEP_ORDER.indexOf(s.name) >= fromIndex) {
        s.status = "PENDING";
        s.error = null;
      }
    });
    job.status = "RUNNING";
    job.pendingStep = null;
    job.pendingPrompts = [];
    job.pendingKind = null;
    job.pendingComplianceResult = null;
    job.pendingFirstRevision = null;
    await job.save();

    opportunity.status = "GENERATING";
    opportunity.generationAttempts = (opportunity.generationAttempts || 0) + 1;
    if (fromIndex <= copyDraftIndex) {
      opportunity.autoRevisionCount = 0;
    }
    await opportunity.save();

    return runSteps({
      opportunity,
      job,
      fromIndex,
      brief: opportunity.brief?.toObject ? opportunity.brief.toObject() : opportunity.brief,
      creativeDraft: opportunity.creativeDraft?.toObject ? opportunity.creativeDraft.toObject() : opportunity.creativeDraft,
    });
  } catch (err) {
    console.error(`[ad-creative-factory] retry setup failed for opportunity ${opportunity._id}:`, err.message);
    job.status = "FAILED";
    job.retryCount += 1;
    job.lastAttemptAt = new Date();
    await job.save();
    opportunity.status = "FAILED";
    opportunity.errorMessage = err.message;
    opportunity.retryCount += 1;
    opportunity.lastAttemptAt = new Date();
    await opportunity.save();
    return { success: false, failedStep: "SETUP", error: err.message, job, opportunity };
  }
}
