import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import SeoContact from "../../src/models/seoContact.model.js";
import SeoOpportunity from "../../src/models/seoOpportunity.model.js";
import { generateOutreachDraft } from "../../src/services/backlinkOutreachAiService.js";

// backlinkOutreachAiService.js must never import sendEmail — outreach drafts
// are never auto-sent. Assert that statically rather than trying to spy on
// an ES module's named export (which Node's mock.method cannot redefine).
test("backlinkOutreachAiService.js never imports sendEmail", () => {
  const source = fs.readFileSync(new URL("../../src/services/backlinkOutreachAiService.js", import.meta.url), "utf8");
  assert.ok(!source.includes("sendEmail"), "generateOutreachDraft must never call sendEmail — drafts are reviewed by a human before sending");
});

const FAKE_AI_RESPONSE = {
  subject: "Loved your resource page on cloud certifications",
  personalizedEmail: "Hi Jane, I came across your resource page and think our AWS course guide would be a great addition...",
  reasonForOutreach: "Their resource page lists cloud training providers and Technohana isn't listed yet.",
  suggestedPage: "https://technohana.com/aws-training",
  suggestedAnchorText: "AWS certification training",
  followUp1: "Just following up on my note last week...",
  followUp2: "Last check-in on this — happy to help if useful!",
};

beforeEach(() => {
  mock.restoreAll();
});

function makeContact(overrides = {}) {
  const state = { aiDrafts: [], ...overrides };
  return {
    ...state,
    save: async function () {
      return this;
    },
  };
}

test("generateOutreachDraft appends a draft with status 'draft' and never sends email", async () => {
  mock.method(SeoContact, "findById", async () => makeContact({ contactName: "Jane", company: "Example Blog", website: "example.com" }));
  mock.method(SeoOpportunity, "findOne", () => ({ lean: async () => null }));

  const callClaudeFn = mock.fn(async () => JSON.stringify(FAKE_AI_RESPONSE));
  const extractJsonFn = (text) => JSON.parse(text);

  const draft = await generateOutreachDraft({ contactId: "abc123", callClaudeFn, extractJsonFn });

  assert.equal(draft.status, "draft");
  assert.equal(draft.subject, FAKE_AI_RESPONSE.subject);
  assert.equal(draft.suggestedAnchorText, FAKE_AI_RESPONSE.suggestedAnchorText);
});

test("generateOutreachDraft pulls context from the linked opportunity when present", async () => {
  const contact = makeContact({ contactName: "Jane", opportunityId: "opp1" });
  mock.method(SeoContact, "findById", async () => contact);
  mock.method(SeoOpportunity, "findById", () => ({
    lean: async () => ({ organizationName: "Example Org", targetPage: "https://technohana.com/aws-training", anchorTextSuggestion: "AWS training" }),
  }));

  const callClaudeFn = mock.fn(async (args) => {
    assert.ok(args.prompt.includes("Example Org"));
    assert.ok(args.prompt.includes("AWS training"));
    return JSON.stringify(FAKE_AI_RESPONSE);
  });
  const extractJsonFn = (text) => JSON.parse(text);

  await generateOutreachDraft({ contactId: "abc123", callClaudeFn, extractJsonFn });
  assert.equal(callClaudeFn.mock.callCount(), 1);
});

test("generateOutreachDraft throws if the AI response is missing a required field", async () => {
  mock.method(SeoContact, "findById", async () => makeContact());
  mock.method(SeoOpportunity, "findOne", () => ({ lean: async () => null }));

  const callClaudeFn = async () => JSON.stringify({ subject: "only a subject" });
  const extractJsonFn = (text) => JSON.parse(text);

  await assert.rejects(() => generateOutreachDraft({ contactId: "abc123", callClaudeFn, extractJsonFn }));
});

test("generateOutreachDraft throws when the contact does not exist", async () => {
  mock.method(SeoContact, "findById", async () => null);
  await assert.rejects(() => generateOutreachDraft({ contactId: "missing" }));
});
