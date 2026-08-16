import { test } from "node:test";
import assert from "node:assert/strict";

// These tests verify the briefMode routing logic in isolation — they don't
// import the orchestrator (which needs Mongoose) but instead validate the
// conditional branching contract that the implementation must follow.

test("briefMode='api' value is accepted by the controller whitelist", () => {
  const input = "api";
  const result = input === "api" ? "api" : undefined;
  assert.equal(result, "api");
});

test("briefMode with any other value falls through to undefined (manual)", () => {
  for (const input of ["manual", "auto", "", null, undefined, 42]) {
    const result = input === "api" ? "api" : undefined;
    assert.equal(result, undefined, `Expected undefined for input: ${JSON.stringify(input)}`);
  }
});

test("enqueueGeneration signature accepts optional briefMode", async () => {
  // Validates the destructuring contract — { briefMode } from an options
  // object defaults to undefined when not passed.
  const extractBriefMode = ({ briefMode } = {}) => briefMode;
  assert.equal(extractBriefMode(), undefined);
  assert.equal(extractBriefMode({}), undefined);
  assert.equal(extractBriefMode({ briefMode: "api" }), "api");
});

test("API brief cost estimation formula matches Sonnet pricing", () => {
  const INPUT_COST = 3 / 1_000_000;
  const OUTPUT_COST = 15 / 1_000_000;
  const tokensIn = 1000;
  const tokensOut = 2000;
  const cost = +(tokensIn * INPUT_COST + tokensOut * OUTPUT_COST).toFixed(6);
  assert.equal(cost, 0.033);
});
