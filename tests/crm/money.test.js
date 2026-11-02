import { test } from "node:test";
import assert from "node:assert/strict";
import { toMinor, mulBp, allocate, add, sub } from "../../src/utils/money.js";
import { businessUnitForPipelineType } from "../../src/constants/businessUnit.js";

test("toMinor avoids float drift", () => {
  assert.equal(toMinor(19.99), 1999);
  assert.equal(toMinor(1.005), 101);
  assert.equal(toMinor(0.1 + 0.2), 30);
  assert.equal(toMinor(-12.5), -1250);
  assert.equal(toMinor("abc"), 0);
});

test("mulBp rounds half away from zero", () => {
  assert.equal(mulBp(10000, 1800), 1800);
  assert.equal(mulBp(1, 5000), 1);
  assert.equal(mulBp(-1, 5000), -1);
  assert.equal(mulBp(999, 1800), 180);
});

test("allocate always sums exactly", () => {
  const parts = allocate(100, [1, 1, 1]);
  assert.equal(parts.reduce((s, v) => s + v, 0), 100);
  assert.deepEqual(parts, [34, 33, 33]);
  assert.equal(allocate(5, [1, 1]).reduce((s, v) => s + v, 0), 5);
});

test("add/sub reject non-integers", () => {
  assert.equal(add(1, 2), 3);
  assert.equal(sub(5, 7), -2);
  assert.throws(() => add(1.5, 2), TypeError);
});

test("pipeline types map to business units, unknown stays null", () => {
  assert.equal(businessUnitForPipelineType("corporate"), "b2b");
  assert.equal(businessUnitForPipelineType("individual"), "b2c");
  assert.equal(businessUnitForPipelineType("ai_projects"), "ai");
  assert.equal(businessUnitForPipelineType("other"), null);
});
