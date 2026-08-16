import ContentOpportunity from "../../models/contentOpportunity.model.js";
import ContentGenerationJob from "../../models/contentGenerationJob.model.js";
import ContentBrief from "../../models/contentBrief.model.js";
import { buildContentBriefPrompt, parseContentBriefResponse, generateContentBriefViaApi } from "./contentBriefWriter.service.js";
import { buildArticleWriterPrompt, parseArticleResponse } from "./articleWriter.service.js";
import { buildSeoFieldWriterPrompt, parseSeoFieldsResponse } from "./seoFieldWriter.service.js";
import { buildInternalLinkerPromptForOpportunity, parseInternalLinksResponse } from "./internalLinker.service.js";
import { buildImagePromptWriterPrompt, parseImageConceptResponse } from "./imagePromptWriter.service.js";
import { buildQualityGatePrompts, resolveQualityGate } from "./qualityGate.service.js";
import { buildRevisionPrompt, parseRevisionResponse } from "./revisionAgent.service.js";

// M3: QUALITY_GATE runs after IMAGE_PROMPT. It may internally trigger ONE
// automatic REVISION pass (tracked via opportunity.autoRevisionCount, capped
// at 1 here) — that sub-step isn't in STEP_ORDER since it's conditional, but
// gets its own entry appended to job.steps when it runs (see runSteps below).
const STEP_ORDER = ["BRIEF", "ARTICLE", "SEO", "LINKS", "IMAGE_PROMPT", "QUALITY_GATE"];

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

// Appends a new step entry to job.steps (used for REVISION, which isn't part
// of the fixed STEP_ORDER since it's conditional on the quality gate flagging
// the draft) and persists it.
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

// Pauses the job/opportunity at `stepName`, storing the prompt(s) the admin
// needs to run manually in Claude Pro and paste responses back for. Never a
// failure — job.status becomes AWAITING_INPUT, not FAILED. `kind` disambiguates
// QUALITY_GATE's two different pause reasons (see job model comment); null
// for every other step, which only ever pauses one way.
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

// Runs STEP_ORDER starting at `fromIndex`, reusing already-persisted data for
// earlier steps (brief / articleDraft / imageConcept passed in) rather than
// regenerating them. Mutates and saves `job` and `opportunity` as it goes.
// Never throws — always returns a result object so callers can respond
// gracefully. When a step needs a manual Claude Pro round trip and no
// response has been submitted yet, this PAUSES (returns awaitingInput:true)
// rather than continuing — resumeStep() below re-enters here once the admin
// submits a response.
async function runSteps({ opportunity, job, fromIndex, brief, articleDraft, imageConcept, resume, briefMode }) {
  // Set inside the QUALITY_GATE branch, consumed after the loop to decide the
  // final opportunity status (NEEDS_REVISION vs HUMAN_REVIEW).
  let qualityGateOutcome = null;

  for (let i = fromIndex; i < STEP_ORDER.length; i++) {
    const stepName = STEP_ORDER[i];
    // `resume` carries the admin's pasted response(s) for exactly one step
    // (the one the job was paused on) — only applies on the first loop
    // iteration; every step after that starts fresh (Phase A: build & pause).
    const resumeForThisStep = resume && resume.stepName === stepName ? resume : null;

    try {
      if (stepName === "BRIEF") {
        if (!resumeForThisStep) {
          if (briefMode === "api") {
            await markStepRunning(job, stepName);
            try {
              const apiResult = await generateContentBriefViaApi({ opportunity });
              brief = apiResult.brief;
              job.briefId = brief._id;
              const step = getStep(job, stepName);
              step.model = apiResult.model || null;
              step.tokensIn = apiResult.usage?.input_tokens || 0;
              step.tokensOut = apiResult.usage?.output_tokens || 0;
              const INPUT_COST = 3 / 1_000_000;
              const OUTPUT_COST = 15 / 1_000_000;
              step.estimatedCostUsd = +(step.tokensIn * INPUT_COST + step.tokensOut * OUTPUT_COST).toFixed(6);
              await markStepDone(job, stepName);
            } catch (apiBriefErr) {
              console.warn(`[content-factory] API brief failed for ${opportunity._id}, falling back to manual:`, apiBriefErr.message);
              const step = getStep(job, stepName);
              step.status = "PENDING";
              step.startedAt = null;
              step.error = null;
              await job.save();
              const { system, prompt } = buildContentBriefPrompt(opportunity);
              return pauseForInput(job, opportunity, stepName, [{ label: "Content brief", system, prompt }]);
            }
          } else {
            const { system, prompt } = buildContentBriefPrompt(opportunity);
            return pauseForInput(job, opportunity, stepName, [{ label: "Content brief", system, prompt }]);
          }
        } else {
          const result = await parseContentBriefResponse(resumeForThisStep.responses[0]?.text, opportunity);
          brief = result.brief;
          job.briefId = brief._id;
          await markStepDone(job, stepName);
        }
      } else if (stepName === "ARTICLE") {
        if (!resumeForThisStep) {
          const { system, prompt } = await buildArticleWriterPrompt(brief, opportunity);
          return pauseForInput(job, opportunity, stepName, [{ label: "Article draft", system, prompt }]);
        }
        const result = parseArticleResponse(resumeForThisStep.responses[0]?.text, brief, opportunity);
        articleDraft = result.articleDraft;
        await markStepDone(job, stepName);
      } else if (stepName === "SEO") {
        if (!resumeForThisStep) {
          const { system, prompt } = buildSeoFieldWriterPrompt({ articleDraft, brief });
          return pauseForInput(job, opportunity, stepName, [{ label: "SEO fields", system, prompt }]);
        }
        const result = parseSeoFieldsResponse(resumeForThisStep.responses[0]?.text, articleDraft, brief);
        articleDraft = { ...articleDraft, ...result.seoFields };
        await markStepDone(job, stepName);
      } else if (stepName === "LINKS") {
        if (!resumeForThisStep) {
          const { prompt, candidateCourses, candidateBlogs } = await buildInternalLinkerPromptForOpportunity(articleDraft, brief, opportunity);
          if (!prompt) {
            // No candidates to choose from — nothing to ask the admin, skip
            // straight through with empty links (mirrors prior behavior).
            const result = parseInternalLinksResponse(null, articleDraft, candidateCourses, candidateBlogs);
            articleDraft = { ...articleDraft, content: result.content, suggestedInternalLinks: result.suggestedInternalLinks };
            await markStepDone(job, stepName);
          } else {
            job.pendingLinkCandidates = { candidateCourses, candidateBlogs };
            return pauseForInput(job, opportunity, stepName, [{ label: "Internal link selection", system: prompt.system, prompt: prompt.prompt }]);
          }
        } else {
          const { candidateCourses, candidateBlogs } = resumeForThisStep.linkCandidates || { candidateCourses: [], candidateBlogs: [] };
          const result = parseInternalLinksResponse(resumeForThisStep.responses[0]?.text, articleDraft, candidateCourses, candidateBlogs);
          articleDraft = { ...articleDraft, content: result.content, suggestedInternalLinks: result.suggestedInternalLinks };
          job.pendingLinkCandidates = null;
          await markStepDone(job, stepName);
        }
      } else if (stepName === "IMAGE_PROMPT") {
        if (!resumeForThisStep) {
          const { system, prompt } = buildImagePromptWriterPrompt({ articleDraft, opportunity });
          return pauseForInput(job, opportunity, stepName, [{ label: "Cover image concept", system, prompt }]);
        }
        const result = parseImageConceptResponse(resumeForThisStep.responses[0]?.text, articleDraft, opportunity);
        imageConcept = result.imageConcept;
        await markStepDone(job, stepName);
      } else if (stepName === "QUALITY_GATE") {
        if (!resumeForThisStep) {
          const prompts = await buildQualityGatePrompts(opportunity._id, articleDraft);
          return pauseForInput(
            job,
            opportunity,
            stepName,
            [
              { label: "Fact-check", system: prompts.factCheck.system, prompt: prompts.factCheck.prompt },
              { label: "AI-style evaluation", system: prompts.aiStyle.system, prompt: prompts.aiStyle.prompt },
              { label: "Quality evaluation", system: prompts.qualityEval.system, prompt: prompts.qualityEval.prompt },
            ],
            "CHECKS"
          );
        }

        // A QUALITY_GATE pause happens for one of three distinct reasons —
        // dispatch on `kind` (persisted on the job at pause time) rather than
        // guessing from which optional fields are set, since the initial
        // 3-prompt trio and the 1-prompt revision rewrite are structurally
        // different requests that both resolve to this same step name.
        if (resumeForThisStep.kind === "REVISION" || resumeForThisStep.kind === "REVISION_STRONGER") {
          const revisionStartedAt = new Date();
          const priorGateResult = job.pendingQualityGateResult;
          const revisionText = resumeForThisStep.responses[0]?.text;
          if (resumeForThisStep.kind === "REVISION") {
            const first = parseRevisionResponse(revisionText, articleDraft);
            if (first.tooSimilar) {
              // First pasted revision read as near-identical — ask for a
              // stronger one instead of silently accepting a synonym-swap.
              const { system, prompt } = buildRevisionPrompt({ articleDraft, qualityScoreResult: priorGateResult, brief, humanNote: null, stronger: true });
              job.pendingFirstRevision = { revised: first.revised, similarity: first.similarity };
              return pauseForInput(job, opportunity, stepName, [{ label: "Automatic revision (stronger rewrite requested)", system, prompt }], "REVISION_STRONGER");
            }
            articleDraft = first.revised;
          } else {
            const first = job.pendingFirstRevision;
            const second = parseRevisionResponse(revisionText, articleDraft);
            // Compare against the first attempt's similarity too — pick
            // whichever diverged more from the original, never silently
            // discard a better first attempt just because a second was requested.
            articleDraft = first && second.similarity > first.similarity ? first.revised : second.revised;
            job.pendingFirstRevision = null;
          }

          opportunity.autoRevisionCount = (opportunity.autoRevisionCount || 0) + 1;
          opportunity.articleDraft = articleDraft;
          await opportunity.save();

          await appendStep(job, { name: "REVISION", error: null, startedAt: revisionStartedAt });

          job.pendingQualityGateResult = null;
          // Re-run the gate on the revised draft — this produces a SECOND
          // ContentQualityScore doc (generationAttempt auto-incremented
          // inside resolveQualityGate), so both attempts' flag history stays
          // visible to the review UI. This needs its own fresh 3-prompt pause.
          const prompts = await buildQualityGatePrompts(opportunity._id, articleDraft);
          return pauseForInput(
            job,
            opportunity,
            stepName,
            [
              { label: "Fact-check (post-revision)", system: prompts.factCheck.system, prompt: prompts.factCheck.prompt },
              { label: "AI-style evaluation (post-revision)", system: prompts.aiStyle.system, prompt: prompts.aiStyle.prompt },
              { label: "Quality evaluation (post-revision)", system: prompts.qualityEval.system, prompt: prompts.qualityEval.prompt },
            ],
            "CHECKS"
          );
        }

        const [factCheckText, aiStyleText, qualityEvalText] = resumeForThisStep.responses.map((r) => r.text);
        const gateResult = await resolveQualityGate(opportunity._id, articleDraft, { factCheckText, aiStyleText, qualityEvalText });

        // Automatic revision pass — capped at exactly 1 (guaranteed by the
        // `autoRevisionCount === 0` guard, never re-entered for this
        // opportunity's automatic pipeline again after this point). In the
        // manual-paste flow this needs its own pause: pause QUALITY_GATE
        // again (job.pendingStep stays QUALITY_GATE) with a REVISION prompt.
        if (gateResult.flaggedForRevision && (opportunity.autoRevisionCount || 0) === 0) {
          const { system, prompt } = buildRevisionPrompt({ articleDraft, qualityScoreResult: gateResult, brief, humanNote: null, stronger: false });
          job.pendingQualityGateResult = gateResult;
          return pauseForInput(job, opportunity, stepName, [{ label: "Automatic revision (flagged draft)", system, prompt }], "REVISION");
        }

        qualityGateOutcome = gateResult;
        job.pendingQualityGateResult = null;
        await markStepDone(job, stepName);
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
      job.pendingStep = null;
      job.pendingPrompts = [];
      job.retryCount += 1;
      job.lastAttemptAt = new Date();
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
  job.pendingStep = null;
  job.pendingPrompts = [];
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
// start. Never throws further up — returns a result object. `jobId`, when
// given, is the caller's already-created ContentGenerationJob._id — using it
// directly (instead of re-deriving "the most recent QUEUED/RUNNING job for
// this opportunity") avoids updating the wrong doc if a double-submit ever
// creates two job docs for the same opportunity.
export async function runGenerationPipeline(opportunityId, jobId, { briefMode } = {}) {
  const opportunity = await ContentOpportunity.findById(opportunityId);
  if (!opportunity) return { success: false, error: "Opportunity not found" };

  try {
    opportunity.status = "GENERATING";
    opportunity.generationAttempts = (opportunity.generationAttempts || 0) + 1;
    // A full restart produces an entirely new article draft, so it gets its
    // own fresh automatic-revision allowance — the cap is "1 automatic pass
    // per generated draft", not "1 ever for this opportunity".
    opportunity.autoRevisionCount = 0;
    await opportunity.save();

    let job = jobId ? await ContentGenerationJob.findById(jobId) : null;
    if (!job) {
      job = await ContentGenerationJob.findOne({ opportunityId, status: { $in: ["QUEUED", "RUNNING"] } }).sort({ createdAt: -1 });
    }
    if (!job) {
      job = new ContentGenerationJob({ opportunityId, status: "RUNNING", steps: [] });
    } else {
      job.status = "RUNNING";
    }
    ensureSteps(job);
    await job.save();

    return runSteps({ opportunity, job, fromIndex: 0, briefMode });
  } catch (err) {
    // Setup before runSteps() has its own step-level try/catch, so a failure
    // here (e.g. the opportunity/job save) would otherwise escape uncaught,
    // leaving the opportunity stuck on GENERATING forever since Bull jobs run
    // with attempts:1 and its "failed" handler only logs.
    console.error(`[content-factory] generation setup failed for opportunity ${opportunity._id}:`, err.message);
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
// job.pendingPrompts (same order/length) — [{ label, text }]. Which pause
// this actually was (the initial 3-prompt QUALITY_GATE trio vs. a 1-prompt
// REVISION rewrite) is read from job.pendingKind, set at pause time — never
// inferred from which optional request fields the caller happened to send.
export async function resumeStep(jobId, { responses }) {
  const job = await ContentGenerationJob.findById(jobId);
  if (!job) return { success: false, error: "Job not found" };
  if (job.status !== "AWAITING_INPUT" || !job.pendingStep) {
    return { success: false, error: `Job is not awaiting input (status: ${job.status})` };
  }

  const expectedCount = job.pendingPrompts.length;
  const providedResponses = Array.isArray(responses) ? responses : [];
  if (providedResponses.length !== expectedCount || providedResponses.some((r) => !r?.text || !String(r.text).trim())) {
    return { success: false, error: `Expected ${expectedCount} non-empty response(s), got ${providedResponses.length}.` };
  }

  const opportunity = await ContentOpportunity.findById(job.opportunityId);
  if (!opportunity) return { success: false, error: "Opportunity not found" };

  const stepName = job.pendingStep;
  const fromIndex = STEP_ORDER.indexOf(stepName);

  const brief = fromIndex > 0 ? await ContentBrief.findOne({ opportunityId: opportunity._id }) : null;
  const articleDraft = opportunity.articleDraft?.toObject ? opportunity.articleDraft.toObject() : opportunity.articleDraft;
  const imageConcept = opportunity.imageConcept?.toObject ? opportunity.imageConcept.toObject() : opportunity.imageConcept;

  const resume = {
    stepName,
    kind: job.pendingKind,
    responses: providedResponses,
    linkCandidates: job.pendingLinkCandidates,
  };

  job.status = "RUNNING";
  job.pendingPrompts = [];
  job.pendingKind = null;
  await job.save();

  return runSteps({ opportunity, job, fromIndex, brief, articleDraft, imageConcept, resume });
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

  try {
    const articleIndex = STEP_ORDER.indexOf("ARTICLE");
    const qualityGateIndex = STEP_ORDER.indexOf("QUALITY_GATE");

    // Reset the target step and any after it so re-running is visible in the
    // ledger; steps before it keep their DONE record untouched. A stray
    // REVISION entry from a previous attempt isn't in STEP_ORDER (it's
    // appended dynamically, not part of the fixed pipeline), so it's handled
    // separately below rather than via the indexOf comparison, which would
    // otherwise never match it (indexOf returns -1) and leave it stale.
    job.steps = job.steps.filter((s) => !(s.name === "REVISION" && fromIndex <= qualityGateIndex));
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
    job.pendingLinkCandidates = null;
    job.pendingQualityGateResult = null;
    job.pendingFirstRevision = null;
    await job.save();

    opportunity.status = "GENERATING";
    opportunity.generationAttempts = (opportunity.generationAttempts || 0) + 1;
    // Retrying from BRIEF or ARTICLE produces an entirely new draft, so — same
    // as a full restart — it gets its own fresh automatic-revision allowance
    // rather than inheriting a count already spent on a prior, different draft.
    if (fromIndex <= articleIndex) {
      opportunity.autoRevisionCount = 0;
    }
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
  } catch (err) {
    // Same rationale as runGenerationPipeline's catch: setup here (job/
    // opportunity save, brief lookup) has no other error handling, and Bull
    // jobs run with attempts:1, so an uncaught rejection here would leave
    // the opportunity/job stuck on GENERATING/RUNNING forever instead of
    // reporting FAILED.
    console.error(`[content-factory] retry setup failed for opportunity ${opportunity._id}:`, err.message);
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
