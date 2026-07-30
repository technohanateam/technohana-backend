import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import SeoOpportunity from "../../src/models/seoOpportunity.model.js";
import SeoContact from "../../src/models/seoContact.model.js";
import SeoMonitoring from "../../src/models/seoMonitoring.model.js";
import SeoSettings from "../../src/models/seoSettings.model.js";
import SeoRecommendation from "../../src/models/seoRecommendation.model.js";
import { generateRecommendationsFromBacklinks } from "../../src/services/recommendationEngine.js";

beforeEach(() => {
  mock.restoreAll();
  mock.method(SeoSettings, "findOne", () => ({ lean: async () => ({ priorityThresholds: { high: 70 } }) }));
  mock.method(SeoRecommendation, "findOneAndUpdate", async () => ({}));
});

test("flags a high-scoring, several-days-old, uncontacted opportunity", async () => {
  mock.method(SeoOpportunity, "find", (filter) => ({
    lean: async () => {
      if (filter.recordType === "priority-opportunity") {
        return [{ _id: "o1", referringDomain: "example.com", overallScore: 85 }];
      }
      return [];
    },
  }));
  mock.method(SeoContact, "find", () => ({ lean: async () => [] }));
  mock.method(SeoMonitoring, "find", () => ({ lean: async () => [] }));

  const upsertSpy = mock.method(SeoRecommendation, "findOneAndUpdate", async () => ({}));
  const summary = await generateRecommendationsFromBacklinks();

  assert.equal(summary.uncontacted, 1);
  assert.equal(upsertSpy.mock.callCount(), 1);
  assert.equal(upsertSpy.mock.calls[0].arguments[0].ruleCode, "HIGH_VALUE_UNCONTACTED_OPPORTUNITY");
});

test("flags stalled outreach only when no follow-up has been completed", async () => {
  mock.method(SeoOpportunity, "find", () => ({ lean: async () => [] }));
  mock.method(SeoMonitoring, "find", () => ({ lean: async () => [] }));
  mock.method(SeoContact, "find", () => ({
    lean: async () => [
      { _id: "c1", website: "stalled.com", nextFollowUp: new Date(0), followUps: [] },
      { _id: "c2", website: "handled.com", nextFollowUp: new Date(0), followUps: [{ completed: true }] },
    ],
  }));

  const upsertSpy = mock.method(SeoRecommendation, "findOneAndUpdate", async () => ({}));
  const summary = await generateRecommendationsFromBacklinks();

  assert.equal(upsertSpy.mock.callCount(), 1);
  assert.equal(upsertSpy.mock.calls[0].arguments[0].affectedUrl, "stalled.com");
  assert.equal(summary.stalled, 2);
});

test("flags a lost link only when there's no active re-outreach contact", async () => {
  mock.method(SeoOpportunity, "find", () => ({ lean: async () => [] }));
  mock.method(SeoContact, "find", () => ({ lean: async () => [] }));
  mock.method(SeoMonitoring, "find", () => ({
    lean: async () => [
      { _id: "m1", website: "no-reoutreach.com", liveUrl: "https://no-reoutreach.com/post", opportunityId: null },
      { _id: "m2", website: "has-reoutreach.com", liveUrl: "https://has-reoutreach.com/post", opportunityId: "opp2" },
    ],
  }));
  mock.method(SeoContact, "findOne", (filter) => ({
    lean: async () => (filter.opportunityId === "opp2" ? { _id: "activeContact" } : null),
  }));

  const upsertSpy = mock.method(SeoRecommendation, "findOneAndUpdate", async () => ({}));
  await generateRecommendationsFromBacklinks();

  assert.equal(upsertSpy.mock.callCount(), 1);
  assert.equal(upsertSpy.mock.calls[0].arguments[0].affectedUrl, "https://no-reoutreach.com/post");
});

test("flags a high-scoring competitor gap", async () => {
  mock.method(SeoOpportunity, "find", (filter) => ({
    lean: async () => {
      if (filter.recordType === "competitor-gap") {
        return [{ _id: "g1", referringDomain: "gap.com", competitor: "CompetitorX", overallScore: 90 }];
      }
      return [];
    },
  }));
  mock.method(SeoContact, "find", () => ({ lean: async () => [] }));
  mock.method(SeoMonitoring, "find", () => ({ lean: async () => [] }));

  const upsertSpy = mock.method(SeoRecommendation, "findOneAndUpdate", async () => ({}));
  const summary = await generateRecommendationsFromBacklinks();

  assert.equal(summary.competitorGaps, 1);
  assert.equal(upsertSpy.mock.calls[0].arguments[0].ruleCode, "COMPETITOR_GAP_HIGH_SCORE");
});
