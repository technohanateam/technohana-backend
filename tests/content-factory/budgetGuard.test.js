import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBudget } from "../../src/services/contentFactory/budgetGuard.service.js";

test("checkBudget allows spend under budget", () => {
  const result = checkBudget({ todaySpendUsd: 5, dailyAiBudgetUsd: 20 }, 2);
  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
});

test("checkBudget blocks spend that would exceed budget", () => {
  const result = checkBudget({ todaySpendUsd: 19, dailyAiBudgetUsd: 20 }, 5);
  assert.equal(result.allowed, false);
  assert.ok(result.reason.includes("daily AI budget"));
});

test("checkBudget treats missing fields as zero", () => {
  const result = checkBudget({}, 0);
  assert.equal(result.allowed, true);
});

test("checkBudget with zero proposed cost still checks current spend", () => {
  const result = checkBudget({ todaySpendUsd: 25, dailyAiBudgetUsd: 20 }, 0);
  assert.equal(result.allowed, false);
});
