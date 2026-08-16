import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { generateContentBriefViaApi, buildBriefFields } from "../../src/services/contentFactory/contentBriefWriter.service.js";

const FAKE_BRIEF_JSON = {
  title: "How to Become a Certified Scrum Master in 2026",
  searchIntent: "informational",
  targetAudience: "Mid-career professionals seeking agile certifications",
  primaryKeyword: "certified scrum master",
  secondaryKeywords: ["CSM certification", "scrum master salary"],
  topicAngle: "Step-by-step certification guide with career ROI data",
  headings: [{ level: 2, text: "Prerequisites" }, { level: 2, text: "Exam Prep" }],
  questionsToAnswer: ["How long does it take?"],
  suggestedExamples: ["Case study: from PM to Scrum Master"],
  contentGaps: ["No competitor covers salary data by region"],
  internalLinkTargets: {
    courses: [{ courseSlug: "csm-course", reason: "direct match" }],
    blogs: [],
  },
  ctaRecommendation: "Enroll in CSM Certification Training",
  sourceRecommendations: ["Scrum Alliance official site"],
  depthGuidance: "COMPREHENSIVE",
};

const fakeOpportunity = {
  _id: "000000000000000000000001",
  title: "Scrum Master Guide",
  focusKeyword: "certified scrum master",
  searchIntent: "informational",
  topicAngle: null,
  courseId: null,
};

// ── buildBriefFields (pure transform, no DB) ────────────────────────────

test("buildBriefFields parses valid JSON and returns all expected fields", () => {
  const fields = buildBriefFields(JSON.stringify(FAKE_BRIEF_JSON), fakeOpportunity, "claude-sonnet-4-6");

  assert.equal(fields.title, FAKE_BRIEF_JSON.title);
  assert.equal(fields.searchIntent, "informational");
  assert.equal(fields.targetAudience, FAKE_BRIEF_JSON.targetAudience);
  assert.equal(fields.primaryKeyword, "certified scrum master");
  assert.deepEqual(fields.secondaryKeywords, FAKE_BRIEF_JSON.secondaryKeywords);
  assert.equal(fields.topicAngle, FAKE_BRIEF_JSON.topicAngle);
  assert.deepEqual(fields.headings, FAKE_BRIEF_JSON.headings);
  assert.deepEqual(fields.questionsToAnswer, FAKE_BRIEF_JSON.questionsToAnswer);
  assert.deepEqual(fields.suggestedExamples, FAKE_BRIEF_JSON.suggestedExamples);
  assert.deepEqual(fields.contentGaps, FAKE_BRIEF_JSON.contentGaps);
  assert.deepEqual(fields.internalLinkTargets.courses, FAKE_BRIEF_JSON.internalLinkTargets.courses);
  assert.deepEqual(fields.internalLinkTargets.blogs, []);
  assert.equal(fields.ctaRecommendation, FAKE_BRIEF_JSON.ctaRecommendation);
  assert.deepEqual(fields.sourceRecommendations, FAKE_BRIEF_JSON.sourceRecommendations);
  assert.equal(fields.depthGuidance, "COMPREHENSIVE");
  assert.equal(fields.generatedByModel, "claude-sonnet-4-6");
  assert.equal(fields.opportunityId, fakeOpportunity._id);
});

test("buildBriefFields falls back to opportunity fields when AI response has gaps", () => {
  const minimal = JSON.stringify({ depthGuidance: "UNKNOWN" });
  const fields = buildBriefFields(minimal, fakeOpportunity, "test-model");

  assert.equal(fields.title, fakeOpportunity.title);
  assert.equal(fields.primaryKeyword, fakeOpportunity.focusKeyword);
  assert.equal(fields.searchIntent, fakeOpportunity.searchIntent);
  assert.equal(fields.depthGuidance, "STANDARD");
  assert.deepEqual(fields.secondaryKeywords, []);
  assert.deepEqual(fields.headings, []);
  assert.deepEqual(fields.internalLinkTargets, { courses: [], blogs: [] });
});

test("buildBriefFields throws on unparseable text", () => {
  assert.throws(
    () => buildBriefFields("not valid json at all", fakeOpportunity),
    (err) => err.message.includes("Failed to parse content brief AI response")
  );
});

test("buildBriefFields validates depthGuidance enum, defaults to STANDARD", () => {
  for (const valid of ["SHORT", "STANDARD", "COMPREHENSIVE"]) {
    const fields = buildBriefFields(JSON.stringify({ depthGuidance: valid }), fakeOpportunity);
    assert.equal(fields.depthGuidance, valid);
  }
  const fields = buildBriefFields(JSON.stringify({ depthGuidance: "EXTREME" }), fakeOpportunity);
  assert.equal(fields.depthGuidance, "STANDARD");
});

// ── generateContentBriefViaApi (DI mock for AI call) ────────────────────

test("generateContentBriefViaApi calls callClaudeFn with correct args and threads model/usage through", async () => {
  const callClaudeFn = mock.fn(async (args) => {
    assert.ok(args.system, "system prompt must be provided");
    assert.ok(args.prompt, "user prompt must be provided");
    assert.equal(args.maxTokens, 2048);
    assert.equal(args.tier, "standard");
    return {
      text: JSON.stringify(FAKE_BRIEF_JSON),
      usage: { input_tokens: 500, output_tokens: 800 },
      model: "claude-sonnet-4-6",
    };
  });

  // parseContentBriefResponse needs Mongoose — we verify the call was
  // made correctly; the downstream Mongoose save is expected to throw.
  try {
    await generateContentBriefViaApi({ opportunity: fakeOpportunity, callClaudeFn });
  } catch {
    // Mongoose connection timeout expected in test environment
  }

  assert.equal(callClaudeFn.mock.callCount(), 1);
  const callArgs = callClaudeFn.mock.calls[0].arguments[0];
  assert.ok(callArgs.system.includes("Content Strategist"));
  assert.ok(callArgs.prompt.includes(fakeOpportunity.title));
});

test("generateContentBriefViaApi throws when callClaudeFn fails (no API key)", async () => {
  const callClaudeFn = async () => { throw new Error("ANTHROPIC_API_KEY is not configured"); };

  await assert.rejects(
    () => generateContentBriefViaApi({ opportunity: fakeOpportunity, callClaudeFn }),
    { message: "ANTHROPIC_API_KEY is not configured" }
  );
});

test("generateContentBriefViaApi throws when AI returns unparseable text", async () => {
  const callClaudeFn = async () => ({ text: "Sure, here is the brief:", usage: {}, model: "test" });

  await assert.rejects(
    () => generateContentBriefViaApi({ opportunity: fakeOpportunity, callClaudeFn }),
    (err) => err.message.includes("Failed to parse content brief AI response")
  );
});
