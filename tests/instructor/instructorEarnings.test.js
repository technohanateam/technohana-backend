import { test } from "node:test";
import assert from "node:assert/strict";
import { monthKey, sessionMinutes, tdsFor, TDS_PERCENT_INR } from "../../src/utils/instructorEarnings.js";

test("months follow India time: a 2am IST class on the 1st is in the new month", () => {
  assert.equal(monthKey("2026-10-31T20:30:00.000Z"), "2026-11");
  assert.equal(monthKey("2026-10-31T18:29:59.000Z"), "2026-10");
});

test("December rolls into January of the next year", () => {
  assert.equal(monthKey("2026-12-31T19:00:00.000Z"), "2027-01");
});

test("session length prefers durationMinutes, else derives it from the times", () => {
  assert.equal(sessionMinutes({ durationMinutes: 75 }), 75);
  assert.equal(sessionMinutes({ startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T11:30:00Z" }), 90);
  assert.equal(sessionMinutes({ startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T09:00:00Z" }), 0);
});

test("INR withholds 10% TDS; other currencies withhold nothing", () => {
  assert.equal(TDS_PERCENT_INR, 10);
  assert.deepEqual(tdsFor(525000, "INR"), { percent: 10, minor: 52500 });
  assert.deepEqual(tdsFor(12000, "USD"), { percent: 0, minor: 0 });
});

test("TDS rounds to the nearest minor unit", () => {
  assert.equal(tdsFor(12345, "INR").minor, 1235);
});
