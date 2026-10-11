import Instructor from "../models/instructor.js";
import Batch from "../models/batch.model.js";
import Session from "../models/session.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import {
  trainerBatchAssignedEmail,
  trainerSessionsScheduledEmail,
  trainerSessionChangedEmail,
  trainerAttendanceReminderEmail,
} from "../utils/emailTemplate.js";

const portalUrl = (path) =>
  `${(process.env.TRAINERS_FRONTEND_URL || process.env.FRONTEND_URL || "https://trainers.technohana.in").replace(/\/$/, "")}${path}`;

// Dates are shown in the batch's own timezone. The admin types that zone as free
// text, so an invalid one falls back to IST instead of throwing.
const formatWhen = (date, timeZone, withTime = true) => {
  const opts = withTime
    ? { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }
    : { day: "numeric", month: "short", year: "numeric" };
  try {
    return new Date(date).toLocaleString("en-IN", { ...opts, timeZone: timeZone || "Asia/Kolkata" });
  } catch {
    return new Date(date).toLocaleString("en-IN", { ...opts, timeZone: "Asia/Kolkata" });
  }
};

const loadActiveInstructor = async (id) => {
  const instructor = await Instructor.findById(id).select("name email isActive").lean();
  return instructor?.isActive && instructor.email ? instructor : null;
};

const send = (to, subject, html) => sendEmail({ from: fromAddresses.careers, to, subject, html });

// Notifications must never fail or slow down the admin action that triggered them.
const fireAndForget = (label, fn) => {
  fn().catch((err) => console.error(`[trainer-notify] ${label} failed:`, err.message));
};

export const notifyBatchAssigned = (batch) =>
  fireAndForget("batch assigned", async () => {
    const instructor = await loadActiveInstructor(batch.instructorId);
    if (!instructor) return;
    await send(
      instructor.email,
      `New batch assigned: ${batch.courseTitle} (${batch.batchCode})`,
      trainerBatchAssignedEmail({
        name: instructor.name,
        courseTitle: batch.courseTitle,
        batchCode: batch.batchCode,
        startLabel: batch.startDate ? formatWhen(batch.startDate, batch.timezone, false) : null,
        endLabel: batch.endDate ? formatWhen(batch.endDate, batch.timezone, false) : null,
        deliveryMode: batch.deliveryMode,
        location: batch.location,
        link: portalUrl(`/instructor/batches/${batch._id}`),
      })
    );
  });

export const notifySessionsScheduled = (batch, sessions) =>
  fireAndForget("sessions scheduled", async () => {
    if (!sessions.length) return;
    const instructor = await loadActiveInstructor(batch.instructorId);
    if (!instructor) return;
    const first = [...sessions].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0];
    await send(
      instructor.email,
      `${sessions.length} session${sessions.length !== 1 ? "s" : ""} scheduled: ${batch.courseTitle}`,
      trainerSessionsScheduledEmail({
        name: instructor.name,
        courseTitle: batch.courseTitle,
        batchCode: batch.batchCode,
        count: sessions.length,
        firstLabel: formatWhen(first.startsAt, batch.timezone),
        link: portalUrl("/instructor/schedule"),
      })
    );
  });

// change: "rescheduled" | "cancelled". Edits to sessions already in the past are
// record corrections, not something the trainer needs to act on.
export const notifySessionChanged = (session, change, previousStartsAt) =>
  fireAndForget("session changed", async () => {
    if (new Date(session.endsAt) < new Date()) return;
    const batch = await Batch.findById(session.batchId).select("instructorId courseTitle batchCode timezone").lean();
    if (!batch) return;
    const instructor = await loadActiveInstructor(batch.instructorId);
    if (!instructor) return;
    await send(
      instructor.email,
      `Session ${change}: ${batch.courseTitle} (${batch.batchCode})`,
      trainerSessionChangedEmail({
        name: instructor.name,
        courseTitle: batch.courseTitle,
        batchCode: batch.batchCode,
        sessionTitle: session.title || `Session ${session.sequence}`,
        change,
        whenLabel: formatWhen(session.startsAt, batch.timezone),
        previousLabel: previousStartsAt ? formatWhen(previousStartsAt, batch.timezone) : null,
        link: portalUrl("/instructor/schedule"),
      })
    );
  });

const REMINDER_LIST_LIMIT = 10;

// Daily nudge: sessions that ended 12h–14d ago with no attendance, one email per
// trainer. Batches with nobody assigned are skipped, since there is nothing to mark.
export async function sendAttendanceReminders() {
  const now = Date.now();
  const sessions = await Session.find({
    attendanceMarkedAt: null,
    status: { $ne: "cancelled" },
    endsAt: { $lt: new Date(now - 12 * 3_600_000), $gt: new Date(now - 14 * 86_400_000) },
  })
    .select("batchId title sequence startsAt")
    .sort({ startsAt: 1 })
    .lean();
  if (!sessions.length) return { sent: 0 };

  const batches = await Batch.find({
    _id: { $in: [...new Set(sessions.map((s) => String(s.batchId)))] },
    enrolledCount: { $gt: 0 },
  })
    .select("instructorId courseTitle batchCode timezone")
    .lean();
  const batchById = new Map(batches.map((b) => [String(b._id), b]));

  const byInstructor = new Map();
  for (const s of sessions) {
    const b = batchById.get(String(s.batchId));
    if (!b) continue;
    const key = String(b.instructorId);
    if (!byInstructor.has(key)) byInstructor.set(key, []);
    byInstructor.get(key).push({
      courseTitle: b.courseTitle,
      batchCode: b.batchCode,
      title: s.title || `Session ${s.sequence}`,
      whenLabel: formatWhen(s.startsAt, b.timezone),
      link: portalUrl(`/instructor/sessions/${s._id}/attendance`),
    });
  }

  let sent = 0;
  for (const [instructorId, list] of byInstructor) {
    const instructor = await loadActiveInstructor(instructorId);
    if (!instructor) continue;
    try {
      await send(
        instructor.email,
        `Attendance pending for ${list.length} session${list.length !== 1 ? "s" : ""}`,
        trainerAttendanceReminderEmail({
          name: instructor.name,
          sessions: list.slice(0, REMINDER_LIST_LIMIT),
          more: Math.max(0, list.length - REMINDER_LIST_LIMIT),
          link: portalUrl("/instructor/schedule"),
        })
      );
      sent += 1;
    } catch (err) {
      console.error(`[trainer-notify] reminder to ${instructorId} failed:`, err.message);
    }
  }
  return { sent };
}
