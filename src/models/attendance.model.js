import mongoose from "mongoose";

// One row per (session, learner).
//
// A separate collection rather than an array on Session: per-learner attendance %
// across a batch aggregates ACROSS sessions, which as an embedded array needs an
// $unwind over every session of the batch. More importantly, a unique index cannot
// be expressed over array elements, so the duplicate guard would have to live in
// application code and re-marking would race.
//
// Deliberately NOT wired to learner progress: attendance never writes
// User.progress, User.lessonsCompleted or User.certificateIssued. Marking a
// learner present is a record of attendance, not of completion.
const attendanceSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true },
    // Denormalized so per-batch aggregation needs no join back through Session.
    batchId:   { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    // The enrollment record (models/user.model.js is one doc per enrollment,
    // not per user account).
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Snapshots, so historical reports stay readable if an enrollment is removed.
    learnerName:  { type: String },
    learnerEmail: { type: String },

    status:          { type: String, enum: ["present", "absent", "late", "excused"], required: true },
    minutesAttended: { type: Number },
    note:            { type: String, maxlength: 500 },

    markedBy:     { type: mongoose.Schema.Types.ObjectId },
    markedByRole: { type: String, enum: ["instructor", "admin"], default: "instructor" },
    markedAt:     { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// The duplicate guard. Also what makes the bulk-mark endpoint's upsert idempotent
// and convergent under concurrent writes without needing a transaction.
attendanceSchema.index({ sessionId: 1, enrollmentId: 1 }, { unique: true });
attendanceSchema.index({ batchId: 1, enrollmentId: 1 });
attendanceSchema.index({ enrollmentId: 1, createdAt: -1 });

export default mongoose.model("Attendance", attendanceSchema);
