// Lets the older Jest-style security tests run under `node --test` without rewriting them.
// Supports only the matchers those tests use.
import assert from "node:assert/strict";
export { describe, test, it, beforeEach, afterEach } from "node:test";

const matchers = (actual, negate = false) => {
  const check = (pass, message) => assert.ok(negate ? !pass : pass, `${negate ? "not " : ""}${message}`);
  return {
    toBe: (expected) => check(Object.is(actual, expected), `expected ${String(actual)} to be ${String(expected)}`),
    toEqual: (expected) => (negate ? assert.notDeepEqual(actual, expected) : assert.deepEqual(actual, expected)),
    toBeDefined: () => check(actual !== undefined, "expected value to be defined"),
    toThrow: () => { let threw = false; try { actual(); } catch { threw = true; } check(threw, "expected function to throw"); },
    toBeNull: () => check(actual === null, "expected value to be null"),
    toBeUndefined: () => check(actual === undefined, "expected value to be undefined"),
    toBeGreaterThan: (n) => check(actual > n, `expected ${actual} > ${n}`),
    toMatch: (re) => check(re.test(actual), `expected ${actual} to match ${re}`),
    toContain: (item) => check(actual.includes(item), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`),
  };
};

export const expect = (actual) => ({ ...matchers(actual), not: matchers(actual, true) });
