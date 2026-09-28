import express from "express";
import mongoose from "mongoose";
import xss from "xss";
import Batch from "../models/batch.model.js";
import Session from "../models/session.model.js";
import Attendance from "../models/attendance.model.js";
import CourseMaterial from "../models/courseMaterial.model.js";
import InstructorAvailability from "../models/instructorAvailability.model.js";
import Course from "../models/course.model.js";
import Instructor from "../models/instructor.js";
import { User } from "../models/user.model.js";
import { planSessions } from "../utils/sessionGenerator.js";
import {
  perLearnerSummaryPipeline,
  batchMatrixPipeline,
  lowAttendancePipeline,
} from "../utils/attendanceAggregations.js";
import { authenticateAdmin, requireAdmin, requirePage } from "../middleware/authenticateAdmin.js";

// Admin-side management of batches, sessions, attendance and materials.
//
// A separate router from admin.routes.js (already 1700+ lines), mounted on the same
// /admin prefix — the established pattern here. Reads need the "batches" page key;
// writes additionally need requireAdmin, which is what keeps the sales role
// read-only without a dedicated middleware.
const router = express.Router();

const canRead = [authenticateAdmin, requirePage("batches")];
const canWrite = [authenticateAdmin, requirePage("batches"), requireAdmin];

const clean = (v) => (typeof v === "string" ? xss(v.trim()) : v);
const badId = (res) => res.status(400).json({ message: "Malformed id." });

// Batch codes are human-facing (emails, invoices), so they are derived from the
// course and start date rather than random, with a numeric suffix on collision.
const generateBatchCode = async (course, startDate, batchType) => {
  const slug = String(course.id || course.courseSlug || course.courseTitle)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 10) || "BATCH";
  const d = startDate ? new Date(startDate) : new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const tag = (batchType || "custom").split("-")[0].toUpperCase().slice(0, 4);

  const base = `${slug}-${stamp}-${tag}`;
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    if (!(await Batch.exists({ batchCode: candidate }))) return candidate;
  }
  return `${base}-${Date.now()}`;
};

const recount = async (batchId) => {
  const [enrolledCount, sessionCount] = await Promise.all([
    User.countDocuments({ batchId }),
    Session.countDocuments({ batchId }),
  ]);
  await Batch.findByIdAndUpdate(batchId, { enrolledCount, sessionCount });
  return { enrolledCount, sessionCount };
};

// ── Batches ───────────────────────────────────────────────────────────────────

router.get("/batches", canRead, async (req, res) => {
  try {
    const { courseId, instructorId, status, q, page = 1, limit = 100 } = req.query;
    const filter = {};
    if (courseId && mongoose.isValidObjectId(courseId)) filter.courseId = courseId;
    if (instructorId && mongoose.isValidObjectId(instructorId)) filter.instructorId = instructorId;
    if (status) filter.status = status;
    if (q) filter.$or = [{ batchCode: new RegExp(q, "i") }, { courseTitle: new RegExp(q, "i") }];

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      Batch.find(filter).sort({ startDate: -1 }).skip(skip).limit(Number(limit)).lean(),
      Batch.countDocuments(filter),
    ]);
    return res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/batches", canWrite, async (req, res) => {
  try {
    const { courseId, instructorId, name, batchType, startDate, endDate, recurrence,
            deliveryMode, trainingType, location, meetingLink, timezone, capacity, notes } = req.body;

    if (!mongoose.isValidObjectId(courseId) || !mongoose.isValidObjectId(instructorId))
      return res.status(400).json({ message: "Valid courseId and instructorId are required." });

    const [course, instructor] = await Promise.all([
      Course.findById(courseId).lean(),
      Instructor.findById(instructorId).select("name isActive").lean(),
    ]);
    if (!course) return res.status(404).json({ message: "Course not found." });
    if (!instructor) return res.status(404).json({ message: "Instructor not found." });
    // An inactive instructor cannot log in, so a batch assigned to one would be
    // invisible to the person expected to teach it.
    if (!instructor.isActive)
      return res.status(400).json({ message: "Instructor account is not activated yet." });

    if (startDate && endDate && new Date(endDate) < new Date(startDate))
      return res.status(400).json({ message: "endDate cannot precede startDate." });

    const batch = await Batch.create({
      batchCode: await generateBatchCode(course, startDate, batchType),
      name: clean(name),
      courseId,
      courseTitle: course.courseTitle,
      instructorId,
      instructorName: instructor.name,
      batchType: batchType || "custom",
      startDate,
      endDate,
      recurrence,
      deliveryMode,
      trainingType,
      location: clean(location),
      meetingLink: clean(meetingLink),
      timezone: timezone || "Asia/Kolkata",
      capacity,
      notes: clean(notes),
      createdBy: req.admin?.email,
    });

    return res.status(201).json({ data: batch });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: "That batch code already exists." });
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/batches/:id", canRead, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const batch = await Batch.findById(req.params.id).lean();
    if (!batch) return res.status(404).json({ message: "Batch not found." });

    const [sessions, learners] = await Promise.all([
      Session.find({ batchId: batch._id }).sort({ startsAt: 1 }).lean(),
      User.find({ batchId: batch._id })
        .select("name email phone status progress lessonsCompleted totalLessons assignedToBatchAt")
        .sort({ name: 1 })
        .lean(),
    ]);

    return res.json({ data: { ...batch, sessions, learners } });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.patch("/batches/:id", canWrite, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: "Batch not found." });

    const allowed = ["name", "batchType", "startDate", "endDate", "recurrence", "deliveryMode",
                     "trainingType", "location", "meetingLink", "timezone", "capacity",
                     "status", "cancelledReason", "notes"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) batch[key] = clean(req.body[key]);
    }

    // Reassignment must cascade to the denormalized copy on Session, which serves
    // the instructor's "upcoming sessions" index. Ownership itself always resolves
    // through Batch, so a lagging cascade cannot grant access — but a stale copy
    // would make sessions vanish from the new instructor's schedule.
    let reassigned = null;
    if (req.body.instructorId && String(req.body.instructorId) !== String(batch.instructorId)) {
      if (!mongoose.isValidObjectId(req.body.instructorId))
        return res.status(400).json({ message: "Malformed instructorId." });
      const next = await Instructor.findById(req.body.instructorId).select("name isActive").lean();
      if (!next) return res.status(404).json({ message: "Instructor not found." });
      if (!next.isActive) return res.status(400).json({ message: "Instructor account is not activated yet." });
      batch.instructorId = next._id;
      batch.instructorName = next.name;
      reassigned = next._id;
    }

    await batch.save();
    if (reassigned) await Session.updateMany({ batchId: batch._id }, { instructorId: reassigned });

    return res.json({ data: batch });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/batches/:id", canWrite, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const batchId = req.params.id;
    const [learnerCount, attendanceCount] = await Promise.all([
      User.countDocuments({ batchId }),
      Attendance.countDocuments({ batchId }),
    ]);
    // Deleting a batch with history would orphan attendance records and silently
    // detach paid enrollments. Cancelling preserves both.
    if (learnerCount > 0 || attendanceCount > 0)
      return res.status(409).json({
        message: `Batch has ${learnerCount} learner(s) and ${attendanceCount} attendance record(s). Set status to "cancelled" instead.`,
      });

    const deleted = await Batch.findByIdAndDelete(batchId);
    if (!deleted) return res.status(404).json({ message: "Batch not found." });
    await Session.deleteMany({ batchId });
    return res.json({ message: "Batch deleted." });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/batches/:id/recount", canWrite, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    if (!(await Batch.exists({ _id: req.params.id })))
      return res.status(404).json({ message: "Batch not found." });
    return res.json({ data: await recount(req.params.id) });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

// ── Roster assignment (the migration path off the courseTitle string join) ─────

router.get("/batches/:id/candidates", canRead, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const batch = await Batch.findById(req.params.id).lean();
    if (!batch) return res.status(404).json({ message: "Batch not found." });

    // Suggestions only. The legacy courseTitle match is never used to assign — a
    // human confirms, and POST /enrollments does the write.
    const candidates = await User.find({
      courseTitle: batch.courseTitle,
      batchId: { $in: [null, undefined] },
      status: { $in: ["enrolled", "in-progress", "completed"] },
    })
      .select("name email phone status batchDate batchTime trainingType createdAt")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const target = batch.legacyBatchDate ? new Date(batch.legacyBatchDate).getTime() : null;
    const scored = candidates.map((c) => {
      let score = 0;
      if (target && c.batchDate) {
        const days = Math.abs(new Date(c.batchDate).getTime() - target) / 86_400_000;
        if (days < 1) score += 2;
        else if (days < 14) score += 1;
      }
      if (batch.legacyBatchTime && c.batchTime === batch.legacyBatchTime) score += 1;
      if (batch.trainingType && c.trainingType === batch.trainingType) score += 1;
      return { ...c, matchScore: score };
    });
    scored.sort((a, b) => b.matchScore - a.matchScore);

    return res.json({ data: scored, total: scored.length });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/batches/:id/enrollments", canWrite, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const { enrollmentIds } = req.body;
    if (!Array.isArray(enrollmentIds) || enrollmentIds.length === 0)
      return res.status(400).json({ message: "enrollmentIds must be a non-empty array." });
    if (!enrollmentIds.every((id) => mongoose.isValidObjectId(id)))
      return res.status(400).json({ message: "enrollmentIds contains a malformed id." });

    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: "Batch not found." });

    const enrollments = await User.find({ _id: { $in: enrollmentIds } })
      .select("courseTitle batchId")
      .lean();
    if (enrollments.length !== enrollmentIds.length)
      return res.status(404).json({ message: "One or more enrollments were not found." });

    // Cross-course assignment would put a learner in a batch for a course they did
    // not buy, and their attendance would be attributed to the wrong course.
    const wrongCourse = enrollments.filter((e) => e.courseTitle !== batch.courseTitle);
    if (wrongCourse.length)
      return res.status(400).json({
        message: `${wrongCourse.length} enrollment(s) are for a different course than "${batch.courseTitle}".`,
      });

    const alreadyElsewhere = enrollments.filter((e) => e.batchId && String(e.batchId) !== String(batch._id));
    if (alreadyElsewhere.length)
      return res.status(409).json({
        message: `${alreadyElsewhere.length} enrollment(s) already belong to another batch. Detach them first.`,
      });

    const toAttach = enrollments.filter((e) => !e.batchId).map((e) => e._id);
    if (batch.capacity > 0) {
      const current = await User.countDocuments({ batchId: batch._id });
      if (current + toAttach.length > batch.capacity)
        return res.status(409).json({
          message: `Capacity is ${batch.capacity}; ${current} already assigned and ${toAttach.length} more requested.`,
        });
    }

    if (toAttach.length) {
      await User.updateMany(
        { _id: { $in: toAttach } },
        { batchId: batch._id, assignedToBatchAt: new Date() }
      );
    }

    return res.json({ data: { attached: toAttach.length, ...(await recount(batch._id)) } });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/batches/:id/enrollments/:enrollmentId", canWrite, async (req, res) => {
  const { id, enrollmentId } = req.params;
  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(enrollmentId)) return badId(res);
  try {
    const updated = await User.findOneAndUpdate(
      { _id: enrollmentId, batchId: id },
      { $unset: { batchId: "", assignedToBatchAt: "" } }
    );
    if (!updated) return res.status(404).json({ message: "Enrollment is not assigned to this batch." });

    // Attendance rows are kept deliberately — they are a record of what happened,
    // and deleting them to tidy up a detach would destroy history.
    const orphaned = await Attendance.countDocuments({ batchId: id, enrollmentId });
    return res.json({
      data: { detached: true, retainedAttendanceRecords: orphaned, ...(await recount(id)) },
    });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

// ── Sessions ──────────────────────────────────────────────────────────────────

router.get("/batches/:id/sessions", canRead, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const sessions = await Session.find({ batchId: req.params.id }).sort({ startsAt: 1 }).lean();
    return res.json({ data: sessions, total: sessions.length });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/batches/:id/generate-sessions", canWrite, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: "Batch not found." });
    if (!batch.startDate) return res.status(400).json({ message: "Batch needs a startDate first." });

    const { replace = false, sessionCount } = req.body;

    const existing = await Session.find({ batchId: batch._id }).select("_id").lean();
    if (existing.length && !replace)
      return res.status(409).json({ message: `Batch already has ${existing.length} session(s). Pass replace:true to regenerate.` });

    if (existing.length && replace) {
      // Never silently discard sessions that already have attendance against them.
      const marked = await Attendance.distinct("sessionId", { batchId: batch._id });
      if (marked.length)
        return res.status(409).json({
          message: `${marked.length} session(s) already have attendance recorded and cannot be regenerated. Edit them individually instead.`,
        });
      await Session.deleteMany({ batchId: batch._id });
    }

    let planned;
    try {
      planned = planSessions({
        startDate: batch.startDate,
        endDate: batch.endDate,
        sessionCount: sessionCount || undefined,
        batchType: batch.batchType,
        recurrence: batch.recurrence?.daysOfWeek?.length ? batch.recurrence : undefined,
        timezone: batch.timezone,
      });
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    if (!planned.length)
      return res.status(400).json({ message: "That date range and schedule produce no sessions." });

    const created = await Session.insertMany(
      planned.map((p) => ({
        batchId: batch._id,
        courseId: batch.courseId,
        instructorId: batch.instructorId,
        sequence: p.sequence,
        title: `Session ${p.sequence}`,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        durationMinutes: p.durationMinutes,
        mode: batch.deliveryMode === "onsite" ? "onsite" : "online",
        meetingLink: batch.meetingLink,
      }))
    );

    await recount(batch._id);
    return res.status(201).json({ data: created, total: created.length });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/batches/:id/sessions", canWrite, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: "Batch not found." });

    const { startsAt, endsAt, title, agenda, mode, meetingLink } = req.body;
    if (!startsAt || !endsAt) return res.status(400).json({ message: "startsAt and endsAt are required." });
    if (new Date(endsAt) <= new Date(startsAt))
      return res.status(400).json({ message: "endsAt must be after startsAt." });

    const last = await Session.findOne({ batchId: batch._id }).sort({ sequence: -1 }).select("sequence").lean();
    const session = await Session.create({
      batchId: batch._id,
      // Derived from the parent, never from the body.
      courseId: batch.courseId,
      instructorId: batch.instructorId,
      sequence: (last?.sequence || 0) + 1,
      title: clean(title) || `Session ${(last?.sequence || 0) + 1}`,
      agenda: clean(agenda),
      startsAt,
      endsAt,
      durationMinutes: Math.round((new Date(endsAt) - new Date(startsAt)) / 60_000),
      mode,
      meetingLink: clean(meetingLink) || batch.meetingLink,
    });

    await recount(batch._id);
    return res.status(201).json({ data: session });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.patch("/sessions/:id", canWrite, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: "Session not found." });

    const allowed = ["title", "agenda", "notes", "startsAt", "endsAt", "mode",
                     "meetingLink", "recordingUrl", "status", "sequence"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) session[key] = clean(req.body[key]);
    }
    if (req.body.startsAt || req.body.endsAt) {
      if (new Date(session.endsAt) <= new Date(session.startsAt))
        return res.status(400).json({ message: "endsAt must be after startsAt." });
      session.durationMinutes = Math.round((session.endsAt - session.startsAt) / 60_000);
    }

    await session.save();
    return res.json({ data: session });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: "Another session already uses that sequence number." });
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/sessions/:id", canWrite, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: "Session not found." });

    const marked = await Attendance.countDocuments({ sessionId: session._id });
    if (marked > 0)
      return res.status(409).json({
        message: `Session has ${marked} attendance record(s). Set status to "cancelled" instead of deleting.`,
      });

    await session.deleteOne();
    await recount(session.batchId);
    return res.json({ message: "Session deleted." });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

// ── Attendance reporting ──────────────────────────────────────────────────────

router.get("/batches/:id/attendance-report", canRead, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const batch = await Batch.findById(req.params.id).lean();
    if (!batch) return res.status(404).json({ message: "Batch not found." });
    const batchId = batch._id;

    const [perLearner, rows, sessions, learners] = await Promise.all([
      Attendance.aggregate(perLearnerSummaryPipeline(batchId)),
      Attendance.aggregate(batchMatrixPipeline(batchId)),
      Session.find({ batchId }).sort({ startsAt: 1 }).select("sequence title startsAt status attendanceMarkedAt").lean(),
      User.find({ batchId }).select("name email").sort({ name: 1 }).lean(),
    ]);

    // Keyed "<enrollmentId>:<sessionId>" so the UI can render the grid directly.
    const matrix = {};
    for (const r of rows) matrix[`${r.enrollmentId}:${r.sessionId}`] = r.status;

    return res.json({
      data: {
        batch: { _id: batch._id, batchCode: batch.batchCode, courseTitle: batch.courseTitle, instructorName: batch.instructorName },
        sessions,
        learners,
        perLearner,
        matrix,
      },
    });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/attendance/overview", canRead, async (req, res) => {
  try {
    const { threshold = 75, status = "in-progress" } = req.query;
    const batches = await Batch.find(status === "all" ? {} : { status })
      .select("_id batchCode courseTitle instructorName")
      .lean();
    if (!batches.length) return res.json({ data: [], total: 0 });

    const byId = new Map(batches.map((b) => [String(b._id), b]));
    const low = await Attendance.aggregate(
      lowAttendancePipeline(batches.map((b) => b._id), Number(threshold))
    );

    return res.json({
      data: low.map((r) => ({
        batch: byId.get(String(r._id.batchId)) || null,
        enrollmentId: r._id.enrollmentId,
        learnerName: r.learnerName,
        learnerEmail: r.learnerEmail,
        attended: r.attended,
        assessable: r.assessable,
        percent: r.percent,
      })),
      total: low.length,
      threshold: Number(threshold),
    });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

// ── Materials moderation ──────────────────────────────────────────────────────

router.get("/materials", canRead, async (req, res) => {
  try {
    const { courseId, batchId, instructorId, kind, visibility } = req.query;
    const filter = { deletedAt: null };
    if (courseId && mongoose.isValidObjectId(courseId)) filter.courseId = courseId;
    if (batchId && mongoose.isValidObjectId(batchId)) filter.batchId = batchId;
    if (instructorId && mongoose.isValidObjectId(instructorId)) filter.instructorId = instructorId;
    if (kind) filter.kind = kind;
    if (visibility) filter.visibility = visibility;

    const data = await CourseMaterial.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    return res.json({ data, total: data.length });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.patch("/materials/:id", canWrite, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const update = {};
    for (const key of ["title", "description", "category", "visibility", "order"]) {
      if (req.body[key] !== undefined) update[key] = clean(req.body[key]);
    }
    const material = await CourseMaterial.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      update,
      { new: true, runValidators: true }
    );
    if (!material) return res.status(404).json({ message: "Material not found." });
    return res.json({ data: material });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/materials/:id", canWrite, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const material = await CourseMaterial.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    );
    if (!material) return res.status(404).json({ message: "Material not found." });
    return res.json({ message: "Material removed." });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

// ── Instructor availability (staffing) ────────────────────────────────────────

router.get("/instructors/:id/availability", authenticateAdmin, requirePage("instructors"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  try {
    const { from, to } = req.query;
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(to);

    const filter = { instructorId: req.params.id };
    if (Object.keys(range).length) filter.date = range;

    const [declared, booked] = await Promise.all([
      InstructorAvailability.find(filter).sort({ date: 1 }).lean(),
      // "Booked" is always derived from real sessions, never stored as a status.
      Session.find({
        instructorId: req.params.id,
        status: { $in: ["scheduled", "rescheduled"] },
        ...(Object.keys(range).length ? { startsAt: range } : {}),
      })
        .select("batchId startsAt endsAt title")
        .sort({ startsAt: 1 })
        .lean(),
    ]);

    return res.json({ data: { declared, booked } });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
