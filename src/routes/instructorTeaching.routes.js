import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import path from "path";
import xss from "xss";
import { v2 as cloudinary } from "cloudinary";
import Batch from "../models/batch.model.js";
import Session from "../models/session.model.js";
import Attendance from "../models/attendance.model.js";
import CourseMaterial from "../models/courseMaterial.model.js";
import InstructorAvailability from "../models/instructorAvailability.model.js";
import Instructor from "../models/instructor.js";
import Course from "../models/course.model.js";
import { User } from "../models/user.model.js";
import { authenticateInstructor } from "../middleware/authenticateInstructor.js";
import { requireCompliance } from "../middleware/requireCompliance.js";
import {
  loadOwnedBatch,
  loadOwnedSession,
  loadOwnedMaterial,
  resolveOwnedBatchFromBody,
} from "../middleware/instructorOwnsResource.js";
import {
  computeAttendanceStats,
  perLearnerSummaryPipeline,
} from "../utils/attendanceAggregations.js";

// Teaching operations for the instructor portal: batches, sessions, attendance,
// materials and availability. Mounted on the same /instructor prefix as
// instructor.routes.js, which keeps auth/profile/earnings separate from this.
//
// Every route is behind authenticateInstructor, and every route that names a
// resource goes through an ownership loader from instructorOwnsResource.js.
const router = express.Router();

// Applied router-wide rather than per route: every endpoint here exposes learner
// data (rosters, attendance) or teaching material, which is exactly what the NDA +
// ethics gate in instructor.routes.js protects. Declaring it once means a new route
// cannot accidentally be added without the gate.
router.use(authenticateInstructor, requireCompliance);

const clean = (v) => (typeof v === "string" ? xss(v.trim()) : v);
const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"];

// A dedicated upload instance: the shared src/middleware/upload.js is disk-based,
// capped at 5MB and rejects .pptx, and the 5MB memory instance in
// instructor.routes.js is sized for resumes. Neither fits teaching material.
const MATERIAL_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "application/zip",
]);
const MATERIAL_EXTENSIONS = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|csv|txt|zip)$/i;

const materialUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extOk = MATERIAL_EXTENSIONS.test(path.extname(file.originalname));
    const mimeOk = MATERIAL_MIME_TYPES.has(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    // Recordings are deliberately not uploadable — they belong as links.
    cb(new Error("Allowed: PDF, Word, PowerPoint, Excel, CSV, TXT, ZIP (max 25MB). Add recordings as a link instead."));
  },
});

// Multer errors surface as thrown exceptions, which would otherwise hit the global
// handler as a 500. These are user mistakes, so they get a 400.
const handleUpload = (field) => (req, res, next) =>
  materialUpload.single(field)(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });

const utcMidnight = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

// ── Batches ───────────────────────────────────────────────────────────────────

router.get("/batches", async (req, res) => {
  try {
    const { status, courseId } = req.query;
    const filter = { instructorId: req.instructor.id };
    if (status) filter.status = status;
    if (courseId && mongoose.isValidObjectId(courseId)) filter.courseId = courseId;

    const batches = await Batch.find(filter).sort({ startDate: -1 }).lean();
    return res.json({ success: true, data: batches });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch batches" });
  }
});

router.get("/batches/:batchId", loadOwnedBatch, async (req, res) => {
  try {
    const batchId = req.batch._id;
    const [sessions, learners, marked] = await Promise.all([
      Session.find({ batchId }).sort({ startsAt: 1 }).lean(),
      User.find({ batchId })
        .select("name email phone status progress lessonsCompleted totalLessons assignedToBatchAt")
        .sort({ name: 1 })
        .lean(),
      Session.countDocuments({ batchId, attendanceMarkedAt: { $ne: null } }),
    ]);

    return res.json({
      success: true,
      data: {
        ...req.batch.toObject(),
        sessions,
        learners,
        attendanceProgress: { markedSessions: marked, totalSessions: sessions.length },
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch batch" });
  }
});

// Instructors can annotate a batch they run, but not redefine it. Dates, capacity,
// course, roster and instructor are commercial facts owned by admin.
router.patch("/batches/:batchId", loadOwnedBatch, async (req, res) => {
  try {
    const { meetingLink, notes, location, status } = req.body;
    if (meetingLink !== undefined) req.batch.meetingLink = clean(meetingLink);
    if (notes !== undefined) req.batch.notes = clean(notes);
    if (location !== undefined) req.batch.location = clean(location);

    if (status !== undefined) {
      const allowedTransitions = {
        scheduled: ["in-progress"],
        "in-progress": ["completed"],
      };
      if (!(allowedTransitions[req.batch.status] || []).includes(status))
        return res.status(400).json({
          success: false,
          message: `Cannot move a batch from "${req.batch.status}" to "${status}".`,
        });
      req.batch.status = status;
    }

    await req.batch.save();
    return res.json({ success: true, data: req.batch });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update batch" });
  }
});

router.get("/batches/:batchId/students", loadOwnedBatch, async (req, res) => {
  try {
    const learners = await User.find({ batchId: req.batch._id })
      .select("name email phone status progress lessonsCompleted totalLessons assignedToBatchAt")
      .sort({ name: 1 })
      .lean();
    return res.json({ success: true, data: learners, batchCode: req.batch.batchCode });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch roster" });
  }
});

// ── Schedule ──────────────────────────────────────────────────────────────────
// Literal paths are declared before /sessions/:sessionId/* so they cannot be
// swallowed by the parameterised routes.

router.get("/schedule", async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 180);
    const from = req.query.from ? new Date(req.query.from) : new Date();
    const to = new Date(from.getTime() + days * 86_400_000);

    const sessions = await Session.find({
      instructorId: req.instructor.id,
      startsAt: { $gte: from, $lte: to },
      status: { $ne: "cancelled" },
    })
      .sort({ startsAt: 1 })
      .lean();

    const batchIds = [...new Set(sessions.map((s) => String(s.batchId)))];
    const batches = await Batch.find({ _id: { $in: batchIds } })
      .select("batchCode courseTitle timezone deliveryMode location")
      .lean();
    const byId = new Map(batches.map((b) => [String(b._id), b]));

    return res.json({
      success: true,
      data: sessions.map((s) => ({ ...s, batch: byId.get(String(s.batchId)) || null })),
      range: { from, to },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch schedule" });
  }
});

router.get("/sessions/pending-attendance", async (req, res) => {
  try {
    const sessions = await Session.find({
      instructorId: req.instructor.id,
      endsAt: { $lt: new Date() },
      status: { $nin: ["cancelled"] },
      attendanceMarkedAt: null,
    })
      .sort({ startsAt: -1 })
      .limit(100)
      .lean();

    const batchIds = [...new Set(sessions.map((s) => String(s.batchId)))];
    const batches = await Batch.find({ _id: { $in: batchIds } }).select("batchCode courseTitle").lean();
    const byId = new Map(batches.map((b) => [String(b._id), b]));

    return res.json({
      success: true,
      data: sessions.map((s) => ({ ...s, batch: byId.get(String(s.batchId)) || null })),
      total: sessions.length,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch pending attendance" });
  }
});

router.get("/batches/:batchId/sessions", loadOwnedBatch, async (req, res) => {
  try {
    const sessions = await Session.find({ batchId: req.batch._id }).sort({ startsAt: 1 }).lean();
    return res.json({ success: true, data: sessions });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch sessions" });
  }
});

router.patch("/sessions/:sessionId", loadOwnedSession, async (req, res) => {
  try {
    const s = req.classSession;
    for (const key of ["title", "agenda", "notes", "meetingLink", "recordingUrl"]) {
      if (req.body[key] !== undefined) s[key] = clean(req.body[key]);
    }
    if (Array.isArray(req.body.topicsCovered)) s.agenda = req.body.topicsCovered.map(clean).join("\n");

    if (req.body.status !== undefined) {
      if (!["scheduled", "completed", "cancelled"].includes(req.body.status))
        return res.status(400).json({ success: false, message: "Invalid session status" });
      s.status = req.body.status;
    }

    await s.save();
    return res.json({ success: true, data: s });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update session" });
  }
});

// ── Attendance ────────────────────────────────────────────────────────────────

router.get("/sessions/:sessionId/attendance", loadOwnedSession, async (req, res) => {
  try {
    const sessionId = req.classSession._id;
    const [roster, records] = await Promise.all([
      User.find({ batchId: req.batch._id }).select("name email").sort({ name: 1 }).lean(),
      Attendance.find({ sessionId }).lean(),
    ]);

    const byEnrollment = new Map(records.map((r) => [String(r.enrollmentId), r]));
    // Unmarked learners come back with status null so the UI can tell "not yet
    // marked" apart from "marked absent".
    const rows = roster.map((l) => {
      const existing = byEnrollment.get(String(l._id));
      return {
        enrollmentId: l._id,
        name: l.name,
        email: l.email,
        status: existing?.status ?? null,
        minutesAttended: existing?.minutesAttended ?? null,
        note: existing?.note ?? "",
      };
    });

    return res.json({
      success: true,
      data: {
        session: req.classSession,
        batch: { _id: req.batch._id, batchCode: req.batch.batchCode, courseTitle: req.batch.courseTitle },
        rows,
        markedAt: req.classSession.attendanceMarkedAt,
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch attendance" });
  }
});

router.put("/sessions/:sessionId/attendance", loadOwnedSession, async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0)
      return res.status(400).json({ success: false, message: "records must be a non-empty array" });
    if (records.length > 500)
      return res.status(400).json({ success: false, message: "Too many records in one request" });

    const bad = records.find((r) => !mongoose.isValidObjectId(r?.enrollmentId) || !ATTENDANCE_STATUSES.includes(r?.status));
    if (bad)
      return res.status(400).json({
        success: false,
        message: `Each record needs a valid enrollmentId and a status of: ${ATTENDANCE_STATUSES.join(", ")}`,
      });

    const ids = [...new Set(records.map((r) => String(r.enrollmentId)))];

    // THE roster whitelist. Owning the session is not sufficient authorization to
    // write a row about an arbitrary enrollment id — without this, a valid
    // instructor token could post another batch's learners and write attendance
    // against them. Only enrollments actually assigned to THIS batch are accepted,
    // and the denormalized name/email come from here, never from the request body.
    const allowed = await User.find({ _id: { $in: ids }, batchId: req.batch._id })
      .select("_id name email")
      .lean();

    if (allowed.length !== ids.length) {
      const ok = new Set(allowed.map((a) => String(a._id)));
      return res.status(400).json({
        success: false,
        message: "Some enrollments are not assigned to this batch",
        rejected: ids.filter((id) => !ok.has(id)),
      });
    }

    const rosterById = new Map(allowed.map((a) => [String(a._id), a]));
    const now = new Date();

    const ops = records.map((r) => {
      const learner = rosterById.get(String(r.enrollmentId));
      return {
        updateOne: {
          filter: { sessionId: req.classSession._id, enrollmentId: learner._id },
          update: {
            $set: {
              status: r.status,
              minutesAttended: Number.isFinite(Number(r.minutesAttended)) ? Number(r.minutesAttended) : undefined,
              note: clean(r.note) || undefined,
              markedBy: req.instructor.id,
              markedByRole: "instructor",
              markedAt: now,
              learnerName: learner.name,
              learnerEmail: learner.email,
            },
            $setOnInsert: { batchId: req.batch._id },
          },
          upsert: true,
        },
      };
    });

    // The unique { sessionId, enrollmentId } index makes this convergent, so a
    // concurrent double-submit needs no transaction — just one retry.
    try {
      await Attendance.bulkWrite(ops, { ordered: false });
    } catch (err) {
      if (err?.code === 11000 || err?.writeErrors?.some((e) => e.code === 11000)) {
        await Attendance.bulkWrite(ops, { ordered: false });
      } else throw err;
    }

    const tallies = await Attendance.aggregate([
      { $match: { sessionId: req.classSession._id } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const t of tallies) if (counts[t._id] !== undefined) counts[t._id] = t.n;

    await Session.findByIdAndUpdate(req.classSession._id, {
      presentCount: counts.present,
      absentCount: counts.absent,
      lateCount: counts.late,
      excusedCount: counts.excused,
      attendanceMarkedAt: now,
      attendanceMarkedBy: req.instructor.id,
    });

    return res.json({ success: true, data: { saved: ops.length, counts, markedAt: now } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to save attendance" });
  }
});

router.get("/batches/:batchId/attendance-summary", loadOwnedBatch, async (req, res) => {
  try {
    const batchId = req.batch._id;
    const [perLearner, totalSessions, roster] = await Promise.all([
      Attendance.aggregate(perLearnerSummaryPipeline(batchId)),
      Session.countDocuments({ batchId, status: { $ne: "cancelled" } }),
      User.find({ batchId }).select("name email").sort({ name: 1 }).lean(),
    ]);

    const byId = new Map(perLearner.map((p) => [String(p._id), p]));
    // Learners with no rows at all must still appear, or an unmarked batch looks empty.
    const rows = roster.map((l) => {
      const agg = byId.get(String(l._id));
      const stats = computeAttendanceStats(
        agg
          ? [
              ...Array(agg.present).fill({ status: "present" }),
              ...Array(agg.absent).fill({ status: "absent" }),
              ...Array(agg.late).fill({ status: "late" }),
              ...Array(agg.excused).fill({ status: "excused" }),
            ]
          : [],
        totalSessions
      );
      return { enrollmentId: l._id, name: l.name, email: l.email, ...stats };
    });

    return res.json({ success: true, data: { totalSessions, rows } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to build attendance summary" });
  }
});

// ── Materials ─────────────────────────────────────────────────────────────────

router.get("/materials", async (req, res) => {
  try {
    const { courseId, batchId, sessionId } = req.query;
    const filter = { instructorId: req.instructor.id, deletedAt: null };
    if (courseId && mongoose.isValidObjectId(courseId)) filter.courseId = courseId;
    if (batchId && mongoose.isValidObjectId(batchId)) filter.batchId = batchId;
    if (sessionId && mongoose.isValidObjectId(sessionId)) filter.sessionId = sessionId;

    const data = await CourseMaterial.find(filter).sort({ courseId: 1, order: 1, createdAt: -1 }).lean();
    return res.json({ success: true, data });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch materials" });
  }
});

// Resolves the course/batch scope of a new material from what the instructor
// actually owns. A body-supplied batchId is only honoured after an ownership check,
// and courseId is then taken from that batch rather than trusted.
const resolveScope = async (body, instructorId) => {
  const viaBatch = await resolveOwnedBatchFromBody(body.batchId, instructorId);
  if (!viaBatch.ok) return viaBatch;
  if (viaBatch.batch) return { ok: true, batch: viaBatch.batch, courseId: viaBatch.batch.courseId };

  // Course-wide material: the course must be one this instructor is assigned to.
  if (!mongoose.isValidObjectId(body.courseId))
    return { ok: false, status: 400, message: "A valid courseId or batchId is required" };
  const owns = await Batch.exists({ courseId: body.courseId, instructorId });
  const assigned = await Course.exists({ _id: body.courseId, instructorId });
  if (!owns && !assigned)
    return { ok: false, status: 403, message: "You are not assigned to that course" };
  return { ok: true, batch: null, courseId: body.courseId };
};

router.post("/materials/link", async (req, res) => {
  try {
    const { title, description, url, provider, category, visibility, order, sessionId } = req.body;
    if (!title || !url)
      return res.status(400).json({ success: false, message: "title and url are required" });

    const scope = await resolveScope(req.body, req.instructor.id);
    if (!scope.ok) return res.status(scope.status).json({ success: false, message: scope.message });

    const material = await CourseMaterial.create({
      kind: "link",
      title: clean(title),
      description: clean(description),
      courseId: scope.courseId,
      batchId: scope.batch?._id || null,
      sessionId: mongoose.isValidObjectId(sessionId) ? sessionId : null,
      instructorId: req.instructor.id,
      uploadedByRole: "instructor",
      link: { url: String(url).trim(), provider: provider || "other" },
      category,
      visibility,
      order,
    });

    return res.status(201).json({ success: true, data: material });
  } catch (err) {
    // The model's pre-validate hook enforces https and the host allowlist.
    if (err?.name === "ValidationError" || /link\.url|https|not allowed/.test(err?.message || ""))
      return res.status(400).json({ success: false, message: err.message });
    return res.status(500).json({ success: false, message: "Failed to save material" });
  }
});

router.post("/materials/file", handleUpload("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
  try {
    const scope = await resolveScope(req.body, req.instructor.id);
    if (!scope.ok) return res.status(scope.status).json({ success: false, message: scope.message });

    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "technohana/course-materials", resource_type: "raw" },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    const material = await CourseMaterial.create({
      kind: "file",
      title: clean(req.body.title) || req.file.originalname,
      description: clean(req.body.description),
      courseId: scope.courseId,
      batchId: scope.batch?._id || null,
      sessionId: mongoose.isValidObjectId(req.body.sessionId) ? req.body.sessionId : null,
      instructorId: req.instructor.id,
      uploadedByRole: "instructor",
      file: {
        publicId: uploaded.public_id,
        url: uploaded.url,
        secureUrl: uploaded.secure_url,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        originalName: req.file.originalname,
        resourceType: "raw",
        format: uploaded.format,
      },
      category: req.body.category,
      visibility: req.body.visibility,
      order: req.body.order,
    });

    return res.status(201).json({ success: true, data: material });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to upload material" });
  }
});

router.patch("/materials/:id", loadOwnedMaterial, async (req, res) => {
  try {
    for (const key of ["title", "description", "category", "visibility", "order"]) {
      if (req.body[key] !== undefined) req.material[key] = clean(req.body[key]);
    }
    await req.material.save();
    return res.json({ success: true, data: req.material });
  } catch (err) {
    if (err?.name === "ValidationError")
      return res.status(400).json({ success: false, message: err.message });
    return res.status(500).json({ success: false, message: "Failed to update material" });
  }
});

router.delete("/materials/:id", loadOwnedMaterial, async (req, res) => {
  try {
    req.material.deletedAt = new Date();
    await req.material.save();

    // Fire and forget: the row is already soft-deleted, so a Cloudinary hiccup
    // must not fail the request.
    if (req.material.kind === "file" && req.material.file?.publicId) {
      cloudinary.uploader
        .destroy(req.material.file.publicId, { resource_type: "raw" })
        .catch(() => {});
    }

    return res.json({ success: true, message: "Material removed" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to remove material" });
  }
});

// Signs a download for a material this instructor owns. The public_id comes from
// the loaded document — never from a query param, which is the flaw the old
// resume-proxy had.
router.get("/materials/:id/download", loadOwnedMaterial, async (req, res) => {
  try {
    if (req.material.kind === "link")
      return res.json({ success: true, url: req.material.link.url });
    if (!req.material.file?.publicId)
      return res.status(404).json({ success: false, message: "Material has no file" });

    const url = cloudinary.utils.private_download_url(req.material.file.publicId, req.material.file.format || null, {
      resource_type: "raw",
      type: "upload",
      attachment: true,
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });

    CourseMaterial.updateOne({ _id: req.material._id }, { $inc: { downloadCount: 1 } }).catch(() => {});
    return res.json({ success: true, url });
  } catch {
    return res.status(502).json({ success: false, message: "Failed to generate download URL" });
  }
});

// ── Availability ──────────────────────────────────────────────────────────────

router.get("/availability", async (req, res) => {
  try {
    const { from, to } = req.query;
    const range = {};
    if (from) range.$gte = utcMidnight(from);
    if (to) range.$lte = utcMidnight(to);

    const filter = { instructorId: req.instructor.id };
    if (range.$gte || range.$lte) filter.date = range;

    const [declared, booked] = await Promise.all([
      InstructorAvailability.find(filter).sort({ date: 1 }).lean(),
      // Booked days are derived from real sessions rather than stored, so the two
      // can never disagree.
      Session.find({
        instructorId: req.instructor.id,
        status: { $in: ["scheduled", "rescheduled"] },
        ...(range.$gte || range.$lte ? { startsAt: range } : {}),
      })
        .select("batchId startsAt endsAt title")
        .sort({ startsAt: 1 })
        .lean(),
    ]);

    return res.json({ success: true, data: { declared, booked } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch availability" });
  }
});

router.put("/availability", async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0)
      return res.status(400).json({ success: false, message: "entries must be a non-empty array" });
    if (entries.length > 400)
      return res.status(400).json({ success: false, message: "Too many entries in one request" });

    const slots = ["full-day", "morning", "afternoon", "evening"];
    const statuses = ["available", "unavailable", "tentative"];

    const ops = [];
    for (const e of entries) {
      const date = utcMidnight(e?.date);
      if (!date) return res.status(400).json({ success: false, message: `Invalid date: ${e?.date}` });
      const slot = e.slot || "full-day";
      const status = e.status || "available";
      if (!slots.includes(slot)) return res.status(400).json({ success: false, message: `Invalid slot: ${slot}` });
      if (!statuses.includes(status)) return res.status(400).json({ success: false, message: `Invalid status: ${status}` });

      ops.push({
        updateOne: {
          filter: { instructorId: req.instructor.id, date, slot },
          update: { $set: { status, note: clean(e.note) || undefined, source: "instructor" } },
          upsert: true,
        },
      });
    }

    await InstructorAvailability.bulkWrite(ops, { ordered: false });
    await Instructor.findByIdAndUpdate(req.instructor.id, { availabilityUpdatedAt: new Date() });

    return res.json({ success: true, data: { saved: ops.length } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to save availability" });
  }
});

router.delete("/availability", async (req, res) => {
  try {
    const from = utcMidnight(req.query.from);
    const to = utcMidnight(req.query.to);
    if (!from || !to)
      return res.status(400).json({ success: false, message: "from and to are required" });

    const result = await InstructorAvailability.deleteMany({
      instructorId: req.instructor.id,
      date: { $gte: from, $lte: to },
    });
    return res.json({ success: true, data: { deleted: result.deletedCount } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to clear availability" });
  }
});

export default router;
