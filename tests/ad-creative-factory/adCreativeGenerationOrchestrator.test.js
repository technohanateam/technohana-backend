import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// Resolve absolute paths for mock.module — must match the specifiers the
// orchestrator's ESM loader actually resolves to. Mirrors
// tests/content-factory/contentGenerationOrchestrator.briefMode.test.js.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../../src/services/adCreativeFactory");

const FAKE_SETTINGS = {
  platformLengthLimits: {
    meta: { headline: 40, primaryText: 125, description: 30 },
    linkedin: { headline: 70, primaryText: 150, description: 100 },
  },
  complianceKeywordBlocklist: ["guaranteed job", "100% placement"],
  brandVoiceRiskThreshold: 30,
};

// In-memory fake "database" — persists object identity across repeated
// findById calls within a test (mirrors a real Mongoose doc's in-place
// mutate-then-save semantics), reset in beforeEach.
let db;

function seedOpportunity(fields) {
  const opp = {
    _id: "opp123",
    courseTitle: "AWS Cloud Practitioner",
    platform: "META",
    campaignObjective: "ENROLLMENT",
    targetAudience: null,
    angle: null,
    brief: null,
    creativeDraft: null,
    complianceFlags: [],
    autoRevisionCount: 0,
    humanRevisionNote: null,
    generationAttempts: 0,
    errorMessage: null,
    retryCount: 0,
    lastAttemptAt: null,
    status: "PLANNED",
    ...fields,
    save: async function () { return this; },
  };
  db.opportunities.set(opp._id, opp);
  return opp;
}

let apiBriefCalled = false;
let apiBriefShouldFail = false;
const FAKE_BRIEF = { angle: "Career switchers", keySellingPoints: ["Live mentors"], tone: "Confident", targetAudience: "Adults", painPoint: null, proofPoint: null };

mock.module(resolve(SRC, "../../models/adCreativeFactory/adCreativeOpportunity.model.js"), {
  defaultExport: { findById: async (id) => db.opportunities.get(id) || null },
});

function FakeAdCreativeGenerationJob(data) {
  Object.assign(this, {
    _id: "job123",
    opportunityId: "opp123",
    status: "QUEUED",
    steps: [],
    pendingStep: null,
    pendingPrompts: [],
    pendingKind: null,
    pendingComplianceResult: null,
    pendingFirstRevision: null,
    retryCount: 0,
    lastAttemptAt: null,
  }, data);
  this.save = async function () { db.jobs.set(this._id, this); return this; };
}
FakeAdCreativeGenerationJob.findById = async (id) => db.jobs.get(id) || null;
FakeAdCreativeGenerationJob.findOne = (query) => ({
  sort: async () => {
    const matches = [...db.jobs.values()].filter(
      (j) => j.opportunityId === query.opportunityId && query.status.$in.includes(j.status)
    );
    return matches[0] || null;
  },
});

mock.module(resolve(SRC, "../../models/adCreativeFactory/adCreativeGenerationJob.model.js"), {
  defaultExport: FakeAdCreativeGenerationJob,
});

mock.module(resolve(SRC, "../../models/adCreativeFactory/adCreativeFactorySettings.model.js"), {
  namedExports: { getOrCreateAdCreativeFactorySettings: async () => FAKE_SETTINGS },
});

// Mock adCopyWriter — the AI-response producing layer. parseAdBriefResponse/
// parseAdCopyDraftResponse just JSON.parse the pasted text directly so tests
// can control exact draft content (including blocklisted phrases), rather
// than re-testing the real parsers (already covered in adCopyWriter.test.js).
mock.module(resolve(SRC, "adCopyWriter.service.js"), {
  namedExports: {
    buildAdBriefPrompt: () => ({ system: "s", prompt: "p" }),
    parseAdBriefResponse: (text) => JSON.parse(text),
    generateAdBriefViaApi: async () => {
      apiBriefCalled = true;
      if (apiBriefShouldFail) throw new Error("Daily AI budget exceeded");
      return { brief: FAKE_BRIEF, model: "claude-sonnet-5", usage: { input_tokens: 200, output_tokens: 150 } };
    },
    buildAdCopyDraftPrompt: () => ({ system: "s", prompt: "p" }),
    parseAdCopyDraftResponse: (text) => JSON.parse(text),
  },
});

// platformComplianceGate.service.js and adCreativeRevisionAgent.service.js
// are used FOR REAL (unmocked) — they're pure functions already covered by
// their own dedicated test files, and exercising them for real here proves
// the orchestrator wires them together correctly end-to-end.
const { runGenerationPipeline, resumeStep } = await import(
  "../../src/services/adCreativeFactory/adCreativeGenerationOrchestrator.service.js"
);

beforeEach(() => {
  db = { opportunities: new Map(), jobs: new Map() };
  apiBriefCalled = false;
  apiBriefShouldFail = false;
});

const CLEAN_BRIEF_TEXT = JSON.stringify(FAKE_BRIEF);
const CLEAN_COPY_TEXT = JSON.stringify({
  headlines: [{ text: "Master AWS Fast", platform: "META" }],
  primaryTexts: [{ text: "Build real cloud projects with expert mentors.", platform: "META" }],
  descriptions: [{ text: "Enroll today.", platform: "META" }],
  ctas: [{ text: "Learn More", platform: "META" }],
});
const BLOCKLISTED_COPY_TEXT = JSON.stringify({
  headlines: [{ text: "Land your dream role", platform: "META" }],
  primaryTexts: [{ text: "We offer guaranteed job placement after this course.", platform: "META" }],
  descriptions: [{ text: "Enroll today.", platform: "META" }],
  ctas: [{ text: "Learn More", platform: "META" }],
});
const CLEAN_REVISION_TEXT = JSON.stringify({
  headlines: [{ text: "Land a Cloud Engineering Role", platform: "META" }],
  primaryTexts: [{ text: "Small cohorts, live mentorship, and a portfolio employers notice.", platform: "META" }],
  // Must stay within FAKE_SETTINGS' 30-char META description limit — at 37
  // the old fixture tripped the oversized check, so the "clean" revision was
  // never actually clean and the gate correctly held it at NEEDS_REVISION.
  descriptions: [{ text: "Limited seats this batch.", platform: "META" }],
  ctas: [{ text: "Apply Now", platform: "META" }],
});
const BRAND_VOICE_CLEAN_TEXT = JSON.stringify({ brandVoiceRiskScore: 10, flagReasons: [] });

test("manual-paste default path: BRIEF -> COPY_DRAFT -> PLATFORM_FIT (auto) -> COMPLIANCE_GATE (BRAND_VOICE) -> HUMAN_REVIEW", async () => {
  seedOpportunity({ status: "PLANNED" });

  const step1 = await runGenerationPipeline("opp123", null, {});
  assert.equal(step1.awaitingInput, true);
  assert.equal(step1.pendingStep, "BRIEF");

  const step2 = await resumeStep("job123", { responses: [{ label: "brief", text: CLEAN_BRIEF_TEXT }] });
  assert.equal(step2.awaitingInput, true);
  assert.equal(step2.pendingStep, "COPY_DRAFT");

  const step3 = await resumeStep("job123", { responses: [{ label: "copy", text: CLEAN_COPY_TEXT }] });
  assert.equal(step3.awaitingInput, true, "should pause at COMPLIANCE_GATE (brand voice) after PLATFORM_FIT resolves automatically");
  assert.equal(step3.pendingStep, "COMPLIANCE_GATE");
  assert.equal(step3.job.pendingKind, "BRAND_VOICE");
  const platformFitStep = step3.job.steps.find((s) => s.name === "PLATFORM_FIT");
  assert.equal(platformFitStep.status, "DONE", "PLATFORM_FIT should resolve synchronously without a pause");

  const step4 = await resumeStep("job123", { responses: [{ label: "brand voice", text: BRAND_VOICE_CLEAN_TEXT }] });
  assert.equal(step4.success, true);
  assert.equal(step4.opportunity.status, "HUMAN_REVIEW");
});

test("skipBrandVoice: true resolves COMPLIANCE_GATE without a brand-voice pasted response", async () => {
  seedOpportunity({ status: "PLANNED" });

  await runGenerationPipeline("opp123", null, { skipBrandVoice: true });
  await resumeStep("job123", { responses: [{ label: "brief", text: CLEAN_BRIEF_TEXT }] });
  const step = await resumeStep("job123", { responses: [{ label: "copy", text: CLEAN_COPY_TEXT }] });

  assert.equal(step.success, true, "clean copy with skipBrandVoice should resolve straight through, no pause");
  assert.equal(step.opportunity.status, "HUMAN_REVIEW");
});

test("a blocklisted phrase triggers exactly one automatic REVISION pass, never a second", async () => {
  seedOpportunity({ status: "PLANNED" });

  await runGenerationPipeline("opp123", null, { skipBrandVoice: true });
  await resumeStep("job123", { responses: [{ label: "brief", text: CLEAN_BRIEF_TEXT }] });
  const gateResult = await resumeStep("job123", { responses: [{ label: "copy", text: BLOCKLISTED_COPY_TEXT }] });

  assert.equal(gateResult.awaitingInput, true, "flagged draft should pause for an automatic revision");
  assert.equal(gateResult.pendingStep, "COMPLIANCE_GATE");
  assert.equal(gateResult.job.pendingKind, "REVISION");
  assert.equal(gateResult.opportunity.autoRevisionCount, 0, "not incremented until the revision is applied");

  const afterRevision = await resumeStep("job123", { responses: [{ label: "revision", text: CLEAN_REVISION_TEXT }] });
  assert.equal(afterRevision.success, true);
  assert.equal(afterRevision.opportunity.autoRevisionCount, 1, "exactly one automatic revision applied");
  assert.equal(afterRevision.opportunity.status, "HUMAN_REVIEW", "clean revised copy should clear the gate");

  const revisionStep = afterRevision.job.steps.find((s) => s.name === "REVISION");
  assert.ok(revisionStep, "a REVISION step should be appended to the job ledger");
  assert.equal(revisionStep.status, "DONE");
});

test("if the revision is still flagged, it lands on NEEDS_REVISION rather than looping a second automatic pass", async () => {
  seedOpportunity({ status: "PLANNED" });

  await runGenerationPipeline("opp123", null, { skipBrandVoice: true });
  await resumeStep("job123", { responses: [{ label: "brief", text: CLEAN_BRIEF_TEXT }] });
  await resumeStep("job123", { responses: [{ label: "copy", text: BLOCKLISTED_COPY_TEXT }] });

  // The "revision" still contains the blocklisted phrase — gate stays flagged.
  const afterRevision = await resumeStep("job123", { responses: [{ label: "revision", text: BLOCKLISTED_COPY_TEXT }] });

  assert.equal(afterRevision.success, true, "runSteps completes, it doesn't error out");
  assert.equal(afterRevision.opportunity.autoRevisionCount, 1, "capped at exactly 1 — never re-enters REVISION a second time");
  assert.equal(afterRevision.opportunity.status, "NEEDS_REVISION");
});

test("briefMode='api' skips the BRIEF pause and proceeds to COPY_DRAFT", async () => {
  seedOpportunity({ status: "PLANNED" });

  const result = await runGenerationPipeline("opp123", null, { briefMode: "api" });

  assert.equal(apiBriefCalled, true);
  assert.equal(result.awaitingInput, true);
  assert.equal(result.pendingStep, "COPY_DRAFT", "API brief succeeded, so BRIEF should be DONE and pause moves to COPY_DRAFT");
  const briefStep = result.job.steps.find((s) => s.name === "BRIEF");
  assert.equal(briefStep.status, "DONE");
});

test("briefMode='api' falls back to a manual BRIEF pause when the API call fails", async () => {
  seedOpportunity({ status: "PLANNED" });
  apiBriefShouldFail = true;

  const result = await runGenerationPipeline("opp123", null, { briefMode: "api" });

  assert.equal(apiBriefCalled, true);
  assert.equal(result.awaitingInput, true);
  assert.equal(result.pendingStep, "BRIEF", "should fall back to manual-paste BRIEF, never throw");
});
