import { test } from "node:test";
import assert from "node:assert/strict";
import { recommendScheduleDate } from "../../src/services/contentFactory/contentBacklog.service.js";

const settings = { targetArticlesPerDay: { softMax: 2 } };

test("recommendScheduleDate returns a date at or after tomorrow", () => {
  const opportunity = { sourceInfo: { priorityTier: "TIER_2_GROWTH" }, clusterId: null };
  const result = recommendScheduleDate(opportunity, [], settings);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  assert.ok(result.getTime() >= tomorrow.getTime());
});

test("recommendScheduleDate skips a day already at softMax", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const existing = [
    { scheduledAt: tomorrow, clusterId: "a" },
    { scheduledAt: tomorrow, clusterId: "b" },
  ];
  const opportunity = { sourceInfo: { priorityTier: "TIER_3_EVERGREEN" }, clusterId: "c" };
  const result = recommendScheduleDate(opportunity, existing, settings);

  assert.notEqual(result.toISOString().slice(0, 10), tomorrow.toISOString().slice(0, 10));
});

test("recommendScheduleDate avoids same-cluster collision on a day under softMax", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const existing = [{ scheduledAt: tomorrow, clusterId: "same-cluster" }];
  const opportunity = { sourceInfo: { priorityTier: "TIER_3_EVERGREEN" }, clusterId: "same-cluster" };
  const result = recommendScheduleDate(opportunity, existing, settings);

  assert.notEqual(result.toISOString().slice(0, 10), tomorrow.toISOString().slice(0, 10));
});

test("recommendScheduleDate is pure — same inputs produce the same output", () => {
  const opportunity = { sourceInfo: { priorityTier: "TIER_1_STRATEGIC" }, clusterId: "x" };
  const existing = [{ scheduledAt: new Date(Date.now() + 86400000), clusterId: "y" }];
  const a = recommendScheduleDate(opportunity, existing, settings);
  const b = recommendScheduleDate(opportunity, existing, settings);
  assert.equal(a.toISOString().slice(0, 10), b.toISOString().slice(0, 10));
});
