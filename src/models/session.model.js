import mongoose from "mongoose";

// One scheduled class meeting within a Batch.
//
// Its own collection rather than a subdocument array on Batch: the instructor's
// primary view is "my upcoming sessions across all my batches", which here is a
// single indexed query on { instructorId, startsAt }. As an embedded array it
// would need an $unwind over every batch the instructor has ever taught, with no
// index able to serve the sort. Sessions also need stable _ids to act as the
// foreign key for attendance rows.
const sessionSchema = new mongoose.Schema(
  {
    batchId:  { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course" },

    // Denormalized query accelerator for the cross-batch "upcoming" lookup ONLY.
    // Never authorize against this field — a stale copy left behind by a failed
    // instructor reassignment would grant a former instructor continued access.
    // Ownership is always resolved through the parent Batch.
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: "Instructor" },

    sequence: { type: Number }, // 1-based, e.g. "Day 3"
    title:    { type: String },
    agenda:   { type: String },
    notes:    { type: String },

    startsAt:        { type: Date, required: true }, // stored UTC
    endsAt:          { type: Date, required: true },
    durationMinutes: { type: Number },

    mode:         { type: String, enum: ["online", "onsite"] }, // overrides the batch default
    meetingLink:  { type: String },
    recordingUrl: { type: String },

    status:          { type: String, enum: ["scheduled", "completed", "cancelled", "rescheduled"], default: "scheduled" },
    rescheduledFrom: { type: Date },

    // null means attendance has not been taken yet — drives the "needs attendance"
    // badge on the instructor schedule.
    attendanceMarkedAt: { type: Date, default: null },
    attendanceMarkedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Instructor" },

    // Denormalized tallies, recomputed on every attendance save so the admin
    // report does not have to aggregate the attendance collection for counts.
    presentCount: { type: Number, default: 0 },
    absentCount:  { type: Number, default: 0 },
    lateCount:    { type: Number, default: 0 },
    excusedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

sessionSchema.index({ instructorId: 1, startsAt: 1 });
sessionSchema.index({ batchId: 1, startsAt: 1 });
sessionSchema.index({ batchId: 1, sequence: 1 }, { unique: true });

export default mongoose.model("Session", sessionSchema);
