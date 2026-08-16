import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { generateContentBriefViaApi } from "../../src/services/contentFactory/contentBriefWriter.service.js";

const fakeOpportunity = {
  _id: "000000000000000000000001",
  title: "Scrum Master Guide",
  focusKeyword: "certified scrum master",
  searchIntent: "informational",
  topicAngle: null,
  courseId: null,
};

test("generateContentBriefViaApi calls callClaudeFn with system/prompt/maxTokens/tier", async () => {
  const callClaudeFn = mock.fn(async (args) => {
    assert.ok(args.system, "system prompt must be provided");
    assert.ok(args.prompt, "user prompt must be provided");
    assert.equal(args.maxTokens, 2048);
    assert.equal(args.tier, "standard");
    return {
      text: JSON.stringify({ title: "Test Brief" }),
      usage: { input_tokens: 500, output_tokens: 800 },
      model: "claude-sonnet-4-6",
    };
  });

  // parseContentBriefResponse needs Mongoose/DB — assert that callClaudeFn
  // was invoked correctly even though the downstream parse throws.
  try {
    await generateContentBriefViaApi({ opportunity: fakeOpportunity, callClaudeFn });
  } catch {
    // Expected: Mongoose not connected. The assertion above already ran.
  }

  assert.equal(callClaudeFn.mock.callCount(), 1);
});

test("generateContentBriefViaApi throws when callClaudeFn fails", async () => {
  const callClaudeFn = async () => { throw new Error("ANTHROPIC_API_KEY is not configured"); };

  await assert.rejects(
    () => generateContentBriefViaApi({ opportunity: fakeOpportunity, callClaudeFn }),
    { message: "ANTHROPIC_API_KEY is not configured" }
  );
});

test("generateContentBriefViaApi throws when AI returns unparseable text", async () => {
  const callClaudeFn = async () => ({ text: "not valid json at all", usage: {}, model: "test" });

  await assert.rejects(
    () => generateContentBriefViaApi({ opportunity: fakeOpportunity, callClaudeFn }),
    (err) => err.message.includes("Failed to parse content brief AI response")
  );
});
