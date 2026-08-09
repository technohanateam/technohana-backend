import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBudget } from "../../src/services/courseFactory/budgetGuard.service.js";

test("checkBudget allows spend under budget", () => {
  const result = checkBudget({ todaySpendUsd: 5, dailyAiBudgetUsd: 25 }, 2);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
});

test("checkBudget blocks spend that would exceed budget", () => {
  const result = checkBudget({ todaySpendUsd: 24, dailyAiBudgetUsd: 25 }, 5);
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes("Course Factory"));
});

test("checkBudget treats missing fields as zero", () => {
  const result = checkBudget({}, 0);
  assert.equal(result.allowed, true);
});
