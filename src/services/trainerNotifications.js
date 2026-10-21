import Instructor from "../models/instructor.js";
import Batch from "../models/batch.model.js";
import Session from "../models/session.model.js";
import TrainingRequirement from "../models/trainingRequirement.model.js";
import InstructorApplication from "../models/instructorApplication.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import {
  newRequirementNotificationEmail,
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

// Only trainers who passed compliance can open gigs (requireCompliance), so anyone
// else would land on a 403. Trainers who already applied are skipped when asked.
async function requirementRecipients(requirement, { excludeApplied = false } = {}) {
  const instructors = await Instructor.find({
    isActive: true,
    "complianceStatus.ndaAccepted": true,
    "complianceStatus.quizPassed": true,
  })
    .select("name email")
    .lean();
  if (!excludeApplied) return instructors;
  const applied = new Set(
    (await InstructorApplication.find({ requirementId: requirement._id }).select("instructorId").lean()).map((a) => String(a.instructorId))
  );
  return instructors.filter((i) => !applied.has(String(i._id)));
}

// Resend allows only a few requests per second, so a big blast in one go gets rate-limited.
const EMAIL_BATCH_SIZE = 2;
const EMAIL_BATCH_GAP_MS = 1100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendRequirementEmails(instructors, requirement, { subject, heading, intro }) {
  const link = portalUrl("/instructor/opportunities");
  const results = [];
  for (let i = 0; i < instructors.length; i += EMAIL_BATCH_SIZE) {
    if (i > 0) await sleep(EMAIL_BATCH_GAP_MS);
    const batch = instructors.slice(i, i + EMAIL_BATCH_SIZE);
    results.push(
      ...(await Promise.allSettled(
        batch.map((inst) =>
          send(inst.email, subject, newRequirementNotificationEmail(inst.name, requirement, link, { heading, intro }))
        )
      ))
    );
  }
  const failures = results.filter((r) => r.status === "rejected" || r.value?.error);
  if (failures.length) {
    const first = failures[0];
    const reason = first.status === "rejected" ? first.reason?.message : first.value.error?.message;
    console.error(`[trainer-notify] "${subject}": ${failures.length}/${results.length} emails failed (first: ${reason})`);
  }
  return results.length - failures.length;
}

// Returns the recipient count; sending runs in the background.
export async function notifyNewRequirement(requirement) {
  const instructors = await requirementRecipients(requirement);
  fireAndForget("new requirement", async () => {
    const sent = await sendRequirementEmails(instructors, requirement, { subject: `New Training Opportunity: ${requirement.title}` });
    await TrainingRequirement.findByIdAndUpdate(requirement._id, { notifiedCount: sent });
  });
  return instructors.length;
}

// kind: "reopened" | "deadline-extended". Closed or already-expired gigs are not worth an alert.
export const notifyRequirementUpdated = (requirement, kind) =>
  fireAndForget(`requirement ${kind}`, async () => {
    if (requirement.status !== "open" || (requirement.deadline && new Date(requirement.deadline) < new Date())) return;
    const instructors = await requirementRecipients(requirement, { excludeApplied: true });
    const reopened = kind === "reopened";
    await sendRequirementEmails(instructors, requirement, {
      subject: `${reopened ? "Reopened" : "Deadline extended"}: ${requirement.title}`,
      heading: reopened ? "Training Opportunity Reopened" : "Deadline Extended",
      intro: reopened ? "this training requirement has been reopened for applications." : "the deadline for this training requirement has been extended.",
    });
  });

const CLOSING_SOON_MS = 48 * 3_600_000;

// Daily: gigs closing within 48h get one reminder, only to trainers who haven't applied.
export async function sendGigClosingReminders() {
  const now = new Date();
  const requirements = await TrainingRequirement.find({
    status: "open",
    deadline: { $gt: now, $lte: new Date(now.getTime() + CLOSING_SOON_MS) },
    closingReminderSentAt: null,
  }).lean();

  let sent = 0;
  for (const requirement of requirements) {
    // Marked before sending so a retry never double-emails the same gig.
    await TrainingRequirement.updateOne({ _id: requirement._id }, { closingReminderSentAt: now });
    const instructors = await requirementRecipients(requirement, { excludeApplied: true });
    sent += await sendRequirementEmails(instructors, requirement, {
      subject: `Closing soon: ${requirement.title}`,
      heading: "Closing Soon",
      intro: "this training requirement closes soon and you have not applied yet.",
    });
  }
  return { sent };
}

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
