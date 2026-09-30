// Pure session-schedule generation. No DB, no I/O — unit tested in
// tests/instructor/sessionGenerator.test.js and shared by the admin
// generate-sessions endpoint.
//
// Times are authored as "minutes from midnight in the batch's IANA timezone" and
// stored as UTC instants. No tz library is installed, so the zone offset is
// resolved with Intl, which uses Node's ICU data and therefore handles DST.

const MINUTES_PER_DAY = 1440;
const MAX_SESSIONS = 365; // safety cap against a runaway date range

// Defaults mirror the BATCH_TYPES vocabulary on the public CourseSchedules page
// (weekday morning 09:00–13:00 IST, weekday evening 18:00–22:00, weekend 09:00–17:00).
export const BATCH_TYPE_DEFAULTS = {
  "weekday-morning": { daysOfWeek: [1, 2, 3, 4, 5], startMinutes: 9 * 60, durationMinutes: 240 },
  "weekday-evening": { daysOfWeek: [1, 2, 3, 4, 5], startMinutes: 18 * 60, durationMinutes: 240 },
  weekend:           { daysOfWeek: [6, 0],          startMinutes: 9 * 60, durationMinutes: 480 },
};

// How far the given instant is ahead of UTC, in ms, in `timeZone`.
const zoneOffsetMs = (instantMs, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));

  const f = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = p.value;

  // Intl renders midnight as hour 24 in some locales/zones.
  const asIfUtc = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour % 24, +f.minute, +f.second);
  return asIfUtc - instantMs;
};

// The UTC instant at which the given wall-clock time occurs in `timeZone`.
export const zonedWallTimeToUtc = ({ year, month, day, minutes }, timeZone) => {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  // First pass uses the offset at the naive instant; a second pass corrects the
  // case where the true instant falls on the other side of a DST transition.
  const firstOffset = zoneOffsetMs(naive, timeZone);
  let utc = naive - firstOffset;
  const secondOffset = zoneOffsetMs(utc, timeZone);
  if (secondOffset !== firstOffset) utc = naive - secondOffset;
  return new Date(utc);
};

// The civil (calendar) date of a date-only value.
//
// startDate/endDate arrive from a date picker as "YYYY-MM-DD" and Mongoose stores
// them at UTC midnight, so the intended calendar day IS the UTC one. Converting
// those to a local calendar date would shift the range a day earlier for any zone
// behind UTC (UTC midnight Apr 6 is Apr 5 in New York). `timezone` governs only the
// wall-clock time of day, which is what zonedWallTimeToUtc handles.
export const civilDateUtc = (date) => {
  const d = new Date(date);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

// The civil (calendar) date an instant falls on in `timeZone`. Kept for callers
// that genuinely need a zone-local calendar day.
export const civilDateInZone = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const f = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = p.value;
  return { year: +f.year, month: +f.month, day: +f.day };
};

const civilToDayOfWeek = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

const addCivilDays = ({ year, month, day }, n) => {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

const compareCivil = (a, b) =>
  a.year - b.year || a.month - b.month || a.day - b.day;

/**
 * Materialize the sessions of a batch.
 *
 * @param {object}  args
 * @param {Date}    args.startDate      first candidate day (inclusive)
 * @param {Date}    [args.endDate]      last candidate day (inclusive). Required unless sessionCount is given.
 * @param {number}  [args.sessionCount] stop after this many sessions, whichever limit comes first
 * @param {string}  [args.batchType]    supplies recurrence defaults when recurrence is omitted
 * @param {object}  [args.recurrence]   { daysOfWeek, startMinutes, durationMinutes } — overrides batchType
 * @param {string}  [args.timezone]     IANA zone the wall times are authored in
 * @returns {Array<{sequence:number,startsAt:Date,endsAt:Date,durationMinutes:number}>}
 */
export const planSessions = ({
  startDate,
  endDate,
  sessionCount,
  batchType = "custom",
  recurrence,
  timezone = "Asia/Kolkata",
}) => {
  if (!startDate) throw new Error("planSessions requires startDate");
  if (!endDate && !sessionCount) throw new Error("planSessions requires endDate or sessionCount");

  const rule = recurrence || BATCH_TYPE_DEFAULTS[batchType];
  if (!rule) throw new Error(`No recurrence supplied and batchType "${batchType}" has no default`);

  const { daysOfWeek, startMinutes, durationMinutes } = rule;
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0)
    throw new Error("recurrence.daysOfWeek must be a non-empty array");
  if (!Number.isFinite(startMinutes) || startMinutes < 0 || startMinutes >= MINUTES_PER_DAY)
    throw new Error("recurrence.startMinutes must be between 0 and 1439");
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0)
    throw new Error("recurrence.durationMinutes must be positive");

  const wanted = new Set(daysOfWeek);
  const limit = Math.min(sessionCount || MAX_SESSIONS, MAX_SESSIONS);

  let cursor = civilDateUtc(startDate);
  const last = endDate ? civilDateUtc(endDate) : null;

  const sessions = [];
  // Bounded independently of the date range so a bad endDate cannot spin.
  for (let guard = 0; guard < MAX_SESSIONS * 8 && sessions.length < limit; guard++) {
    if (last && compareCivil(cursor, last) > 0) break;

    if (wanted.has(civilToDayOfWeek(cursor))) {
      const startsAt = zonedWallTimeToUtc({ ...cursor, minutes: startMinutes }, timezone);
      sessions.push({
        sequence: sessions.length + 1,
        startsAt,
        endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
        durationMinutes,
      });
    }
    cursor = addCivilDays(cursor, 1);
  }

  return sessions;
};

export default planSessions;
