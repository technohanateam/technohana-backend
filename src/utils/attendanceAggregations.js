// Attendance maths and the reusable aggregation pipelines.
//
// computeAttendanceStats is pure and unit tested. The pipeline builders live here
// too so the instructor summary, the admin batch report and the admin low-attendance
// overview all share one definition of "attendance %" rather than each rolling
// their own.

// "Late" counts toward attendance — the learner was present, just not punctually.
// "Excused" is deliberately excluded from BOTH numerator and denominator: an
// excused absence should neither reward nor penalise the learner's percentage.
const COUNTED_PRESENT = ["present", "late"];

/**
 * @param {Array<{status:string}>} records  attendance rows for one learner
 * @param {number} [totalSessions]          sessions scheduled for the batch
 */
export const computeAttendanceStats = (records = [], totalSessions = 0) => {
  const tally = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of records) {
    if (tally[r?.status] !== undefined) tally[r.status] += 1;
  }

  const marked = tally.present + tally.absent + tally.late + tally.excused;
  // Excused sessions drop out of the denominator entirely.
  const assessable = marked - tally.excused;
  const attended = tally.present + tally.late;

  return {
    ...tally,
    marked,
    totalSessions,
    // null, not 0, when there is nothing to judge — "not yet marked" and
    // "attended nothing" must not render identically.
    percent: assessable > 0 ? Math.round((attended / assessable) * 100) : null,
    // Progress against the whole batch, which is what an admin chasing a
    // mid-course dropout actually wants. Also null until something is marked —
    // otherwise an untouched batch reads as 0% attendance for everyone.
    percentOfScheduled:
      totalSessions > 0 && marked > 0 ? Math.round((attended / totalSessions) * 100) : null,
  };
};

export const isCountedPresent = (status) => COUNTED_PRESENT.includes(status);

/** Per-learner rollup for one batch, in one round trip. */
export const perLearnerSummaryPipeline = (batchId) => [
  { $match: { batchId } },
  {
    $group: {
      _id: "$enrollmentId",
      learnerName:  { $first: "$learnerName" },
      learnerEmail: { $first: "$learnerEmail" },
      present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
      absent:  { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
      late:    { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } },
      excused: { $sum: { $cond: [{ $eq: ["$status", "excused"] }, 1, 0] } },
    },
  },
  {
    $addFields: {
      attended:   { $add: ["$present", "$late"] },
      assessable: { $add: ["$present", "$late", "$absent"] },
    },
  },
  {
    $addFields: {
      percent: {
        $cond: [
          { $gt: ["$assessable", 0] },
          { $round: [{ $multiply: [{ $divide: ["$attended", "$assessable"] }, 100] }, 0] },
          null,
        ],
      },
    },
  },
  { $sort: { learnerName: 1 } },
];

/** Every row of a batch, for building a learner × session matrix in the handler. */
export const batchMatrixPipeline = (batchId) => [
  { $match: { batchId } },
  {
    $project: {
      _id: 0,
      sessionId: 1,
      enrollmentId: 1,
      status: 1,
      learnerName: 1,
      learnerEmail: 1,
      minutesAttended: 1,
      note: 1,
    },
  },
];

/**
 * Learners below an attendance threshold across a set of batches.
 * @param {Array<ObjectId>} batchIds
 * @param {number} threshold  percentage, e.g. 75
 */
export const lowAttendancePipeline = (batchIds, threshold = 75) => [
  { $match: { batchId: { $in: batchIds } } },
  {
    $group: {
      _id: { batchId: "$batchId", enrollmentId: "$enrollmentId" },
      learnerName:  { $first: "$learnerName" },
      learnerEmail: { $first: "$learnerEmail" },
      attended:   { $sum: { $cond: [{ $in: ["$status", COUNTED_PRESENT] }, 1, 0] } },
      assessable: { $sum: { $cond: [{ $eq: ["$status", "excused"] }, 0, 1] } },
    },
  },
  { $match: { assessable: { $gt: 0 } } },
  {
    $addFields: {
      percent: { $round: [{ $multiply: [{ $divide: ["$attended", "$assessable"] }, 100] }, 0] },
    },
  },
  { $match: { percent: { $lt: threshold } } },
  { $sort: { percent: 1 } },
];

export default computeAttendanceStats;
