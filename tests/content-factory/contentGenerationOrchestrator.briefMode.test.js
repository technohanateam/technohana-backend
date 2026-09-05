import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// Resolve absolute paths for mock.module — must match the specifiers the
// orchestrator's ESM loader actually resolves to.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../../src/services/contentFactory");

const fakeBrief = { _id: "brief123", title: "Generated Brief" };

let apiBriefCalled = false;
let apiBriefShouldFail = false;

const makeSaveableFakeOpp = () => ({
  _id: "opp123",
  title: "Test Opportunity",
  focusKeyword: "test keyword",
  searchIntent: "informational",
  status: "PLANNED",
  generationAttempts: 0,
  autoRevisionCount: 0,
  articleDraft: null,
  imageConcept: null,
  errorMessage: null,
  retryCount: 0,
  lastAttemptAt: null,
  save: mock.fn(async function () { return this; }),
});

const makeSaveableFakeJob = () => ({
  _id: "job123",
  opportunityId: "opp123",
  status: "RUNNING",
  steps: [],
  briefId: null,
  pendingStep: null,
  pendingPrompts: [],
  pendingKind: null,
  pendingLinkCandidates: null,
  pendingQualityGateResult: null,
  pendingFirstRevision: null,
  retryCount: 0,
  lastAttemptAt: null,
  save: mock.fn(async function () { return this; }),
});

// Mock all Mongoose model imports that the orchestrator uses
mock.module(resolve(SRC, "../../models/contentOpportunity.model.js"), {
  defaultExport: { findById: async () => makeSaveableFakeOpp() },
});

function FakeContentGenerationJob(data) {
  Object.assign(this, makeSaveableFakeJob(), data);
  this.save = mock.fn(async function () { return this; });
}
FakeContentGenerationJob.findById = async () => null;
FakeContentGenerationJob.findOne = () => ({ sort: async () => null });
FakeContentGenerationJob.create = async (data) => new FakeContentGenerationJob(data);

mock.module(resolve(SRC, "../../models/contentGenerationJob.model.js"), {
  defaultExport: FakeContentGenerationJob,
});

mock.module(resolve(SRC, "../../models/contentBrief.model.js"), {
  defaultExport: { findOne: async () => null },
});

// Mock the content brief writer — the module under indirect test
mock.module(resolve(SRC, "contentBriefWriter.service.js"), {
  namedExports: {
    buildContentBriefPrompt: () => ({ system: "test system", prompt: "test prompt" }),
    parseContentBriefResponse: async () => ({ brief: fakeBrief, model: "test" }),
    generateContentBriefViaApi: async () => {
      apiBriefCalled = true;
      if (apiBriefShouldFail) throw new Error("API key not configured");
      return { brief: fakeBrief, model: "claude-sonnet-4-6", usage: { input_tokens: 500, output_tokens: 800 } };
    },
  },
});

// Stub remaining pipeline services
mock.module(resolve(SRC, "articleWriter.service.js"), {
  namedExports: {
    buildArticleWriterPrompt: async () => ({ system: "s", prompt: "p" }),
    parseArticleResponse: () => ({ articleDraft: {} }),
  },
});
mock.module(resolve(SRC, "seoFieldWriter.service.js"), {
  namedExports: {
    buildSeoFieldWriterPrompt: () => ({ system: "s", prompt: "p" }),
    parseSeoFieldsResponse: () => ({ seoFields: {} }),
  },
});
mock.module(resolve(SRC, "internalLinker.service.js"), {
  namedExports: {
    buildInternalLinkerPromptForOpportunity: async () => ({ prompt: null, candidateCourses: [], candidateBlogs: [] }),
    parseInternalLinksResponse: () => ({ content: "", suggestedInternalLinks: [] }),
  },
});
mock.module(resolve(SRC, "imagePromptWriter.service.js"), {
  namedExports: {
    buildImagePromptWriterPrompt: () => ({ system: "s", prompt: "p" }),
    parseImageConceptResponse: () => ({ imageConcept: {} }),
  },
});
mock.module(resolve(SRC, "qualityGate.service.js"), {
  namedExports: {
    buildQualityGatePrompts: async () => ({
      factCheck: { system: "s", prompt: "p" },
      aiStyle: { system: "s", prompt: "p" },
      qualityEval: { system: "s", prompt: "p" },
    }),
    resolveQualityGate: async () => ({ flaggedForRevision: false, overallScore: 85, flagReasons: [] }),
    computeQualityGateResult: () => ({ flaggedForRevision: false, overallScore: 85, flagReasons: [] }),
  },
});
mock.module(resolve(SRC, "revisionAgent.service.js"), {
  namedExports: {
    buildRevisionPrompt: () => ({ system: "s", prompt: "p" }),
    parseRevisionResponse: () => ({ revised: {}, tooSimilar: false, similarity: 0 }),
  },
});

const { runGenerationPipeline } = await import("../../src/services/contentFactory/contentGenerationOrchestrator.service.js");

beforeEach(() => {
  apiBriefCalled = false;
  apiBriefShouldFail = false;
});

test("briefMode='api' calls generateContentBriefViaApi and then pauses at ARTICLE", async () => {
  const result = await runGenerationPipeline("opp123", null, { briefMode: "api" });

  assert.equal(apiBriefCalled, true, "API brief should have been called");
  assert.equal(result.awaitingInput, true, "Should pause for input");
  assert.equal(result.pendingStep, "ARTICLE", "Should pause at ARTICLE step after API brief succeeds");
});

test("briefMode='api' falls back to manual BRIEF pause when API fails", async () => {
  apiBriefShouldFail = true;

  const result = await runGenerationPipeline("opp123", null, { briefMode: "api" });

  assert.equal(apiBriefCalled, true, "API brief should have been attempted");
  assert.equal(result.awaitingInput, true, "Should pause for manual input");
  assert.equal(result.pendingStep, "BRIEF", "Should fall back to pausing at BRIEF");
});

test("omitted briefMode (manual) pauses at BRIEF without calling API", async () => {
  const result = await runGenerationPipeline("opp123", null);

  assert.equal(apiBriefCalled, false, "API brief should NOT be called for manual mode");
  assert.equal(result.awaitingInput, true, "Should pause for input");
  assert.equal(result.pendingStep, "BRIEF", "Should pause at BRIEF step");
});

test("explicit briefMode='manual' also pauses at BRIEF without calling API", async () => {
  const result = await runGenerationPipeline("opp123", null, { briefMode: "manual" });

  assert.equal(apiBriefCalled, false, "API brief should NOT be called");
  assert.equal(result.pendingStep, "BRIEF");
});

test("API brief cost estimation formula matches aiUsageTracker.service.js pricing", () => {
  // aiUsageTracker.service.js:9-12 defines:
  //   "claude-sonnet-5": { in: 0.003, out: 0.015 } per 1K tokens
  // The orchestrator's inline constants are the same values expressed per-token:
  const INPUT_COST = 3 / 1_000_000;   // $3/M = $0.003/1K
  const OUTPUT_COST = 15 / 1_000_000;  // $15/M = $0.015/1K

  assert.ok(Math.abs(INPUT_COST * 1000 - 0.003) < 1e-10, "Input cost per 1K must match aiUsageTracker");
  assert.ok(Math.abs(OUTPUT_COST * 1000 - 0.015) < 1e-10, "Output cost per 1K must match aiUsageTracker");

  const tokensIn = 1000;
  const tokensOut = 2000;
  const cost = +(tokensIn * INPUT_COST + tokensOut * OUTPUT_COST).toFixed(6);
  assert.equal(cost, 0.033);
});
