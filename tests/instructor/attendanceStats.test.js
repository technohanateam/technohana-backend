import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAttendanceStats, isCountedPresent } from "../../src/utils/attendanceAggregations.js";

const rows = (...statuses) => statuses.map((status) => ({ status }));

test("late counts as attended", () => {
  const s = computeAttendanceStats(rows("present", "late", "absent", "present"), 4);
  assert.equal(s.present, 2);
  assert.equal(s.late, 1);
  assert.equal(s.absent, 1);
  // 3 attended of 4 assessable
  assert.equal(s.percent, 75);
});

test("excused is excluded from both numerator and denominator", () => {
  // 1 present, 1 excused → 100%, not 50%.
  const s = computeAttendanceStats(rows("present", "excused"), 2);
  assert.equal(s.excused, 1);
  assert.equal(s.marked, 2);
  assert.equal(s.percent, 100);
});

test("an all-excused learner has no judgeable percentage", () => {
  const s = computeAttendanceStats(rows("excused", "excused"), 5);
  assert.equal(s.percent, null);
});

test("no records yields null rather than zero", () => {
  const s = computeAttendanceStats([], 6);
  assert.equal(s.marked, 0);
  assert.equal(s.percent, null, "0% and 'not yet marked' must not render identically");
  assert.equal(s.percentOfScheduled, null);
});

test("full absence is 0%, distinct from unmarked", () => {
  const s = computeAttendanceStats(rows("absent", "absent"), 2);
  assert.equal(s.percent, 0);
});

test("partial marking judges only what was marked, and reports scheduled separately", () => {
  // 10-session batch, only 4 marked so far, 3 attended.
  const s = computeAttendanceStats(rows("present", "present", "late", "absent"), 10);
  assert.equal(s.marked, 4);
  assert.equal(s.percent, 75);
  assert.equal(s.percentOfScheduled, 30);
});

test("percentages are rounded to whole numbers", () => {
  // 2 of 3 = 66.66…
  const s = computeAttendanceStats(rows("present", "present", "absent"), 3);
  assert.equal(s.percent, 67);
});

test("unknown or malformed statuses are ignored, not counted", () => {
  const s = computeAttendanceStats(
    [{ status: "present" }, { status: "bogus" }, {}, null, { status: "absent" }],
    2
  );
  assert.equal(s.marked, 2);
  assert.equal(s.percent, 50);
});

test("totalSessions defaults harmlessly when omitted", () => {
  const s = computeAttendanceStats(rows("present"));
  assert.equal(s.totalSessions, 0);
  assert.equal(s.percentOfScheduled, null);
  assert.equal(s.percent, 100);
});

test("isCountedPresent agrees with the percentage maths", () => {
  assert.equal(isCountedPresent("present"), true);
  assert.equal(isCountedPresent("late"), true);
  assert.equal(isCountedPresent("absent"), false);
  assert.equal(isCountedPresent("excused"), false);
});
