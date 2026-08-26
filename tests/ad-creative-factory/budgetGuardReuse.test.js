import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBudget } from "../../src/services/contentFactory/budgetGuard.service.js";

// Proves the "sibling settings doc, shared pure function" design decision:
// Content Factory's checkBudget() is reused unmodified against an
// AdCreativeFactorySettings-shaped plain object — no fork needed, since the
// function only reads dailyAiBudgetUsd/todaySpendUsd off whatever object it's given.

test("checkBudget allows a call within an AdCreativeFactorySettings-shaped budget", () => {
  const adCreativeSettings = { dailyAiBudgetUsd: 2, todaySpendUsd: 0.5 };
  const { allowed } = checkBudget(adCreativeSettings, 0.01);
  assert.equal(allowed, true);
});

test("checkBudget rejects a call that would exceed an AdCreativeFactorySettings-shaped budget", () => {
  const adCreativeSettings = { dailyAiBudgetUsd: 2, todaySpendUsd: 1.995 };
  const { allowed, reason } = checkBudget(adCreativeSettings, 0.01);
  assert.equal(allowed, false);
  assert.match(reason, /daily AI budget/);
});

test("checkBudget treats a fresh AdCreativeFactorySettings (todaySpendUsd: 0) as fully available", () => {
  const freshSettings = { dailyAiBudgetUsd: 2, todaySpendUsd: 0 };
  const { allowed } = checkBudget(freshSettings, 1.99);
  assert.equal(allowed, true);
});
