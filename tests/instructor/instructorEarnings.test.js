import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthKey,
  sessionMinutes,
  tdsFor,
  TDS_PERCENT_INR,
  buildPayoutClaim,
} from "../../src/utils/instructorEarnings.js";

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

// ── Payout ledger ─────────────────────────────────────────────────────────────

const batchById = new Map([
  ["b-inr", { _id: "b-inr", batchCode: "AZ-1", courseTitle: "Azure", trainerHourlyRateMinor: 200000, trainerRateCurrency: "INR" }],
  ["b-usd", { _id: "b-usd", batchCode: "US-1", courseTitle: "AWS", trainerHourlyRateMinor: 5000, trainerRateCurrency: "USD" }],
  ["b-unrated", { _id: "b-unrated", batchCode: "NR-1", courseTitle: "GCP", trainerHourlyRateMinor: null }],
]);
const session = (id, batchId, startsAt, durationMinutes = 60) => ({ _id: id, batchId, startsAt: new Date(startsAt), durationMinutes });
const sessions = [
  session("s2", "b-inr", "2026-09-10T04:30:00Z", 90),
  session("s1", "b-inr", "2026-09-03T04:30:00Z"),
  session("s3", "b-usd", "2026-09-04T04:30:00Z"),
  session("s4", "b-unrated", "2026-09-05T04:30:00Z"),
];
const claim = (livePayouts = [], claimedElsewhere = []) =>
  buildPayoutClaim({ sessions, batchById, currency: "INR", livePayouts, claimedElsewhere });

test("a first claim takes every unbilled session at its batch rate, oldest first, less TDS", () => {
  const c = claim();
  assert.deepEqual(c.lines.map((l) => l.sessionId), ["s1", "s2"]);
  assert.deepEqual(c.lines.map((l) => l.amountMinor), [200000, 300000]);
  assert.equal(c.grossMinor, 500000);
  assert.equal(c.tdsMinor, 50000);
  assert.equal(c.absorbedLegacyMinor, 0);
  assert.equal(c.amountMinor, 450000);
  assert.equal(c.periodStart.toISOString(), "2026-09-03T04:30:00.000Z");
  assert.equal(c.periodEnd.toISOString(), "2026-09-10T04:30:00.000Z");
});

test("unrated and other-currency sessions are counted but not claimed", () => {
  const c = claim();
  assert.equal(c.unratedSessions, 1);
  assert.equal(c.otherCurrencySessions, 1);
});

test("sessions already on a live ledger payout are not claimed again", () => {
  const c = claim([{ currency: "INR", ledger: true, amountMinor: 180000, lines: [{ sessionId: "s1" }] }]);
  assert.deepEqual(c.lines.map((l) => l.sessionId), ["s2"]);
  assert.equal(c.amountMinor, 270000);
});

test("a session already paid to another trainer is not claimable after attendance is re-marked", () => {
  const c = claim([], ["s1"]);
  assert.deepEqual(c.lines.map((l) => l.sessionId), ["s2"]);
  assert.equal(c.amountMinor, 270000);
});

test("payouts in another currency don't affect the claim", () => {
  const c = claim([{ currency: "USD", ledger: true, amountMinor: 5000, lines: [{ sessionId: "s1" }] }, { currency: "USD", amountMinor: 999 }]);
  assert.equal(c.lines.length, 2);
  assert.equal(c.amountMinor, 450000);
});

test("pre-ledger payout amounts are netted off the first ledger claim", () => {
  const c = claim([{ currency: "INR", amountMinor: 100000 }]);
  assert.equal(c.lines.length, 2);
  assert.equal(c.absorbedLegacyMinor, 100000);
  assert.equal(c.amountMinor, 350000);
});

test("pre-ledger amounts already netted off are not subtracted twice", () => {
  const c = claim([
    { currency: "INR", amountMinor: 100000 },
    { currency: "INR", ledger: true, amountMinor: 80000, absorbedLegacyMinor: 100000, lines: [{ sessionId: "s1" }] },
  ]);
  assert.deepEqual(c.lines.map((l) => l.sessionId), ["s2"]);
  assert.equal(c.absorbedLegacyMinor, 0);
  assert.equal(c.amountMinor, 270000);
});

test("when earlier payouts exceed the unbilled sessions, nothing is claimable", () => {
  const c = claim([{ currency: "INR", amountMinor: 600000 }]);
  assert.equal(c.absorbedLegacyMinor, 450000);
  assert.equal(c.amountMinor, 0);
});

test("a netted-off pre-ledger payout that was later rejected is paid back", () => {
  // The pre-ledger payout is no longer live, but a ledger payout absorbed 100000 of it.
  const c = claim([{ currency: "INR", ledger: true, amountMinor: 80000, absorbedLegacyMinor: 100000, lines: [{ sessionId: "s1" }] }]);
  assert.equal(c.absorbedLegacyMinor, -100000);
  assert.equal(c.amountMinor, 370000);
});

test("a ledger payout with no lines still counts its absorbed amount", () => {
  const c = claim([
    { currency: "INR", amountMinor: 50000 },
    { currency: "INR", ledger: true, amountMinor: 0, absorbedLegacyMinor: 50000, lines: [] },
  ]);
  assert.equal(c.absorbedLegacyMinor, 0);
  assert.equal(c.amountMinor, 450000);
});
