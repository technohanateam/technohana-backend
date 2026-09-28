import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planSessions,
  zonedWallTimeToUtc,
  civilDateInZone,
  civilDateUtc,
  BATCH_TYPE_DEFAULTS,
} from "../../src/utils/sessionGenerator.js";

// ── zone conversion ───────────────────────────────────────────────────────────

test("zonedWallTimeToUtc converts IST wall time to the right UTC instant", () => {
  // 09:00 IST = 03:30 UTC (IST is UTC+5:30, no DST)
  const utc = zonedWallTimeToUtc({ year: 2026, month: 4, day: 6, minutes: 9 * 60 }, "Asia/Kolkata");
  assert.equal(utc.toISOString(), "2026-04-06T03:30:00.000Z");
});

test("zonedWallTimeToUtc handles a zone with DST on both sides of the transition", () => {
  // US Eastern: EST (UTC-5) in January, EDT (UTC-4) in July. Same wall time, different offsets.
  const winter = zonedWallTimeToUtc({ year: 2026, month: 1, day: 15, minutes: 9 * 60 }, "America/New_York");
  const summer = zonedWallTimeToUtc({ year: 2026, month: 7, day: 15, minutes: 9 * 60 }, "America/New_York");
  assert.equal(winter.toISOString(), "2026-01-15T14:00:00.000Z");
  assert.equal(summer.toISOString(), "2026-07-15T13:00:00.000Z");
});

test("civilDateInZone reports the local calendar date, not the UTC one", () => {
  // 22:00 UTC on Mar 15 is already 03:30 on Mar 16 in IST.
  const civil = civilDateInZone(new Date("2026-03-15T22:00:00.000Z"), "Asia/Kolkata");
  assert.deepEqual(civil, { year: 2026, month: 3, day: 16 });
});

test("civilDateUtc treats a date-only value as the calendar day it was picked as", () => {
  assert.deepEqual(civilDateUtc(new Date("2026-04-06T00:00:00.000Z")), { year: 2026, month: 4, day: 6 });
});

test("a batch in a behind-UTC zone starts on the day the admin picked", () => {
  // The date picker sends "2026-04-06", stored as UTC midnight. Interpreting that
  // as a New York calendar date would yield Apr 5 — a Sunday — and a weekday batch
  // would silently start a day late.
  const [first] = planSessions({
    startDate: new Date("2026-04-06T00:00:00.000Z"), // Monday
    sessionCount: 1,
    batchType: "weekday-morning",
    timezone: "America/New_York",
  });
  // 09:00 EDT on Apr 6 = 13:00 UTC.
  assert.equal(first.startsAt.toISOString(), "2026-04-06T13:00:00.000Z");
});

// ── weekday batches ───────────────────────────────────────────────────────────

test("weekday batch skips Saturday and Sunday", () => {
  // 2026-04-06 is a Monday.
  const sessions = planSessions({
    startDate: new Date("2026-04-06T00:00:00.000Z"),
    sessionCount: 7,
    batchType: "weekday-morning",
    timezone: "Asia/Kolkata",
  });

  assert.equal(sessions.length, 7);
  for (const s of sessions) {
    const dow = new Date(s.startsAt).getUTCDay();
    assert.ok(dow >= 1 && dow <= 5, `expected a weekday, got day ${dow} for ${s.startsAt.toISOString()}`);
  }
  // 7 weekday sessions from a Monday land on the following Tuesday.
  assert.equal(sessions[0].startsAt.toISOString(), "2026-04-06T03:30:00.000Z");
  assert.equal(sessions[6].startsAt.toISOString(), "2026-04-14T03:30:00.000Z");
});

test("weekend batch picks only Saturday and Sunday", () => {
  const sessions = planSessions({
    startDate: new Date("2026-04-06T00:00:00.000Z"), // Monday
    sessionCount: 4,
    batchType: "weekend",
    timezone: "Asia/Kolkata",
  });

  assert.equal(sessions.length, 4);
  for (const s of sessions) {
    const dow = new Date(s.startsAt).getUTCDay();
    assert.ok(dow === 0 || dow === 6, `expected a weekend day, got ${dow}`);
  }
  // First weekend day after Monday Apr 6 is Saturday Apr 11.
  assert.equal(sessions[0].startsAt.toISOString(), "2026-04-11T03:30:00.000Z");
});

test("sequence numbers are 1-based and contiguous", () => {
  const sessions = planSessions({
    startDate: new Date("2026-04-06T00:00:00.000Z"),
    sessionCount: 5,
    batchType: "weekday-evening",
  });
  assert.deepEqual(sessions.map((s) => s.sequence), [1, 2, 3, 4, 5]);
});

test("duration is applied to endsAt", () => {
  const [first] = planSessions({
    startDate: new Date("2026-04-06T00:00:00.000Z"),
    sessionCount: 1,
    batchType: "weekday-morning",
  });
  assert.equal(first.durationMinutes, 240);
  assert.equal(first.endsAt.getTime() - first.startsAt.getTime(), 240 * 60_000);
  assert.equal(first.endsAt.toISOString(), "2026-04-06T07:30:00.000Z");
});

// ── bounds ────────────────────────────────────────────────────────────────────

test("endDate is inclusive and caps the run", () => {
  const sessions = planSessions({
    startDate: new Date("2026-04-06T00:00:00.000Z"), // Mon
    endDate: new Date("2026-04-08T00:00:00.000Z"),   // Wed
    batchType: "weekday-morning",
  });
  assert.equal(sessions.length, 3);
  assert.equal(sessions[2].startsAt.toISOString(), "2026-04-08T03:30:00.000Z");
});

test("sessionCount wins when it is the tighter bound", () => {
  const sessions = planSessions({
    startDate: new Date("2026-04-06T00:00:00.000Z"),
    endDate: new Date("2026-12-31T00:00:00.000Z"),
    sessionCount: 3,
    batchType: "weekday-morning",
  });
  assert.equal(sessions.length, 3);
});

test("a range containing no matching weekday yields no sessions", () => {
  // Sat Apr 11 – Sun Apr 12, asking for weekdays only.
  const sessions = planSessions({
    startDate: new Date("2026-04-11T00:00:00.000Z"),
    endDate: new Date("2026-04-12T00:00:00.000Z"),
    batchType: "weekday-morning",
  });
  assert.equal(sessions.length, 0);
});

test("generation is capped so an open-ended range cannot run away", () => {
  const sessions = planSessions({
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2099-01-01T00:00:00.000Z"),
    recurrence: { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startMinutes: 600, durationMinutes: 60 },
  });
  assert.equal(sessions.length, 365);
});

// ── custom recurrence + validation ────────────────────────────────────────────

test("explicit recurrence overrides the batchType default", () => {
  const sessions = planSessions({
    startDate: new Date("2026-04-06T00:00:00.000Z"),
    sessionCount: 2,
    batchType: "weekday-morning",
    recurrence: { daysOfWeek: [1], startMinutes: 15 * 60, durationMinutes: 90 },
    timezone: "Asia/Kolkata",
  });
  // Mondays only, 15:00 IST = 09:30 UTC, a week apart.
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].startsAt.toISOString(), "2026-04-06T09:30:00.000Z");
  assert.equal(sessions[1].startsAt.toISOString(), "2026-04-13T09:30:00.000Z");
  assert.equal(sessions[0].durationMinutes, 90);
});

test("a DST-crossing batch keeps a constant local start time", () => {
  // US DST began 2026-03-08. A Monday batch spanning it must stay 09:00 local,
  // which means the UTC instant shifts by an hour.
  const sessions = planSessions({
    startDate: new Date("2026-03-02T12:00:00.000Z"), // Mon Mar 2, before the change
    sessionCount: 2,
    recurrence: { daysOfWeek: [1], startMinutes: 9 * 60, durationMinutes: 60 },
    timezone: "America/New_York",
  });
  assert.equal(sessions[0].startsAt.toISOString(), "2026-03-02T14:00:00.000Z"); // EST, UTC-5
  assert.equal(sessions[1].startsAt.toISOString(), "2026-03-09T13:00:00.000Z"); // EDT, UTC-4
});

test("custom batchType without a recurrence is rejected", () => {
  assert.throws(
    () => planSessions({ startDate: new Date("2026-04-06T00:00:00.000Z"), sessionCount: 1, batchType: "custom" }),
    /no default/
  );
});

test("missing bounds and malformed recurrence are rejected", () => {
  assert.throws(() => planSessions({ sessionCount: 1, batchType: "weekend" }), /startDate/);
  assert.throws(
    () => planSessions({ startDate: new Date(), batchType: "weekend" }),
    /endDate or sessionCount/
  );
  assert.throws(
    () => planSessions({ startDate: new Date(), sessionCount: 1, recurrence: { daysOfWeek: [], startMinutes: 0, durationMinutes: 60 } }),
    /daysOfWeek/
  );
  assert.throws(
    () => planSessions({ startDate: new Date(), sessionCount: 1, recurrence: { daysOfWeek: [1], startMinutes: 1500, durationMinutes: 60 } }),
    /startMinutes/
  );
  assert.throws(
    () => planSessions({ startDate: new Date(), sessionCount: 1, recurrence: { daysOfWeek: [1], startMinutes: 60, durationMinutes: 0 } }),
    /durationMinutes/
  );
});

test("batch type defaults match the published schedule vocabulary", () => {
  assert.deepEqual(BATCH_TYPE_DEFAULTS["weekday-morning"].daysOfWeek, [1, 2, 3, 4, 5]);
  assert.deepEqual(BATCH_TYPE_DEFAULTS.weekend.daysOfWeek, [6, 0]);
  assert.equal(BATCH_TYPE_DEFAULTS["weekday-evening"].startMinutes, 18 * 60);
});
