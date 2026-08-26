import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAdBriefResponse, parseAdCopyDraftResponse } from "../../src/services/adCreativeFactory/adCopyWriter.service.js";

test("parseAdBriefResponse: valid JSON maps fields correctly", () => {
  const text = JSON.stringify({
    angle: "Career switchers into cloud",
    keySellingPoints: ["Live mentors", "Hands-on labs", "Portfolio projects"],
    tone: "Confident, specific",
    targetAudience: "Early-career professionals",
    painPoint: "Stuck in a non-technical role",
    proofPoint: "Small cohort sizes",
  });
  const brief = parseAdBriefResponse(text);
  assert.equal(brief.angle, "Career switchers into cloud");
  assert.deepEqual(brief.keySellingPoints, ["Live mentors", "Hands-on labs", "Portfolio projects"]);
  assert.equal(brief.tone, "Confident, specific");
});

test("parseAdBriefResponse: malformed JSON throws a clear error", () => {
  assert.throws(() => parseAdBriefResponse("not json at all"), /Failed to parse ad brief AI response/);
});

test("parseAdCopyDraftResponse: normalizes variant arrays", () => {
  const text = JSON.stringify({
    headlines: [{ text: "Master AWS Fast", platform: "META" }],
    primaryTexts: [{ text: "Build real projects.", platform: "META" }],
    descriptions: [{ text: "Enroll today.", platform: "META" }],
    ctas: [{ text: "Learn More", platform: "META" }],
  });
  const draft = parseAdCopyDraftResponse(text, { platform: "META" });
  assert.equal(draft.headlines.length, 1);
  assert.equal(draft.headlines[0].text, "Master AWS Fast");
  assert.equal(draft.primaryTexts[0].text, "Build real projects.");
});

test("parseAdCopyDraftResponse: a variant missing platform falls back to the opportunity's platform", () => {
  const text = JSON.stringify({
    headlines: [{ text: "No platform field here" }],
    primaryTexts: [],
    descriptions: [],
    ctas: [],
  });
  const draft = parseAdCopyDraftResponse(text, { platform: "LINKEDIN" });
  assert.equal(draft.headlines[0].platform, "LINKEDIN");
});

test("parseAdCopyDraftResponse: platform 'BOTH' falls back to META for variants missing platform", () => {
  const text = JSON.stringify({
    headlines: [{ text: "No platform field here" }],
    primaryTexts: [],
    descriptions: [],
    ctas: [],
  });
  const draft = parseAdCopyDraftResponse(text, { platform: "BOTH" });
  assert.equal(draft.headlines[0].platform, "META");
});

test("parseAdCopyDraftResponse: malformed JSON throws a clear error", () => {
  assert.throws(() => parseAdCopyDraftResponse("not json", { platform: "META" }), /Failed to parse ad copy draft AI response/);
});
