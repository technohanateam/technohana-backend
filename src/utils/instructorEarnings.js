import Session from "../models/session.model.js";
import Batch from "../models/batch.model.js";

// Shared by GET /instructor/earnings and the payout-request endpoints, so the
// balance a trainer can withdraw is exactly what the Earnings page shows.
//
// Trainer pay is delivered hours × the batch's hourly rate (set by admin per
// batch), less TDS. A session counts once attendance is marked and it isn't
// cancelled. It is credited to whoever marked attendance: Session.instructorId is
// rewritten for past sessions when a batch is reassigned, so it can't be used.
// Course revenue is company data and plays no part in this.

export const TDS_PERCENT_INR = 10; // Sec 194J, INR payouts only

// Months follow India time (no DST), so a 2am IST class on the 1st falls in the
// new month even though it is still the previous day in UTC.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const monthKey = (date) => {
  const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const sessionMinutes = (s) =>
  s.durationMinutes || Math.max(0, Math.round((new Date(s.endsAt) - new Date(s.startsAt)) / 60_000));

export const tdsFor = (grossMinor, currency) => {
  const percent = currency === "INR" ? TDS_PERCENT_INR : 0;
  return { percent, minor: Math.round((grossMinor * percent) / 100) };
};

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Amounts are totalled only for batches priced in `currency` (the trainer's
 * payout currency); sessions on batches priced in another currency or with no
 * rate yet are counted separately so the trainer can see why they're missing.
 */
export const computeInstructorEarnings = async (instructorId, currency = "INR") => {
  const sessions = await Session.find({
    attendanceMarkedBy: instructorId,
    attendanceMarkedAt: { $ne: null },
    status: { $ne: "cancelled" },
  })
    .select("batchId startsAt endsAt durationMinutes")
    .sort({ startsAt: 1 })
    .lean();

  const batches = await Batch.find({ _id: { $in: [...new Set(sessions.map((s) => String(s.batchId)))] } })
    .select("batchCode courseTitle trainerHourlyRateMinor trainerRateCurrency")
    .lean();
  const batchById = new Map(batches.map((b) => [String(b._id), b]));

  const months = new Map();
  const perBatch = new Map();
  let minutesDelivered = 0;
  let grossMinor = 0;
  let unratedSessions = 0;
  let otherCurrencySessions = 0;

  for (const s of sessions) {
    const b = batchById.get(String(s.batchId));
    if (!b) continue;
    const minutes = sessionMinutes(s);
    minutesDelivered += minutes;

    const rated = b.trainerHourlyRateMinor != null;
    const batchCurrency = b.trainerRateCurrency || "INR";
    const payable = rated && batchCurrency === currency;
    const amount = rated ? Math.round((b.trainerHourlyRateMinor * minutes) / 60) : 0;
    if (!rated) unratedSessions += 1;
    else if (!payable) otherCurrencySessions += 1;
    if (payable) grossMinor += amount;

    const key = monthKey(s.startsAt);
    const m = months.get(key) || { month: key, sessions: 0, minutes: 0, grossMinor: 0 };
    m.sessions += 1;
    m.minutes += minutes;
    if (payable) m.grossMinor += amount;
    months.set(key, m);

    const bk = String(b._id);
    const row = perBatch.get(bk) || {
      batchId: bk,
      batchCode: b.batchCode,
      courseTitle: b.courseTitle,
      currency: batchCurrency,
      rateMinor: rated ? b.trainerHourlyRateMinor : null,
      sessions: 0,
      minutes: 0,
      grossMinor: 0,
    };
    row.sessions += 1;
    row.minutes += minutes;
    row.grossMinor += amount;
    perBatch.set(bk, row);
  }

  const tds = tdsFor(grossMinor, currency);
  return {
    currency,
    totalMinor: grossMinor - tds.minor, // net payable — what a trainer can request
    grossMinor,
    tdsPercent: tds.percent,
    tdsMinor: tds.minor,
    sessionsDelivered: sessions.length,
    hoursDelivered: round1(minutesDelivered / 60),
    byMonth: [...months.values()].map((m) => ({ ...m, hours: round1(m.minutes / 60) })),
    byBatch: [...perBatch.values()]
      .map((b) => ({ ...b, hours: round1(b.minutes / 60) }))
      .sort((a, b) => b.sessions - a.sessions),
    unratedSessions,
    otherCurrencySessions,
  };
};
