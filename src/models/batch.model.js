import mongoose from "mongoose";

// A Batch is one cohort of one course, run by one instructor. It exists because
// the instructor→learner link was previously a string join on courseTitle, which
// cannot tell two concurrent cohorts of the same course apart — and attendance is
// meaningless without that distinction.
const recurrenceSchema = new mongoose.Schema(
  {
    // 0 = Sunday … 6 = Saturday
    daysOfWeek:      [{ type: Number, min: 0, max: 6 }],
    // Minutes from midnight, interpreted in the batch's `timezone`, not UTC.
    startMinutes:    { type: Number, min: 0, max: 1439 },
    durationMinutes: { type: Number, min: 15 },
  },
  { _id: false }
);

const batchSchema = new mongoose.Schema(
  {
    batchCode:    { type: String, required: true, unique: true, uppercase: true, trim: true },
    name:         { type: String, trim: true },

    courseId:     { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    // Denormalized snapshot: lets lists render without a populate, and is what the
    // admin "candidate enrollments" matcher compares against the legacy
    // User.courseTitle field.
    courseTitle:  { type: String, required: true },

    // The authority for every instructor ownership check. Session.instructorId is
    // a denormalized copy for querying and must never be used to authorize.
    instructorId:   { type: mongoose.Schema.Types.ObjectId, ref: "Instructor", required: true },
    instructorName: { type: String },

    deliveryMode: { type: String, enum: ["online", "onsite", "hybrid"], default: "online" },
    trainingType: { type: String, enum: ["individual", "group", "corporate"], default: "group" },
    location:     { type: String },
    meetingLink:  { type: String },

    // IANA zone. Session start times are stored in UTC but authored in this zone.
    timezone:     { type: String, default: "Asia/Kolkata" },

    startDate:    { type: Date },
    endDate:      { type: Date },

    // Mirrors the typeTag vocabulary used by the public CourseSchedules page so
    // that page can eventually be backed by real batches.
    batchType:    { type: String, enum: ["weekday-morning", "weekday-evening", "weekend", "custom"], default: "custom" },
    recurrence:   { type: recurrenceSchema, default: undefined },

    capacity:      { type: Number, default: 0 }, // 0 = unlimited
    enrolledCount: { type: Number, default: 0 }, // maintained by attach/detach; repairable via recount
    sessionCount:  { type: Number, default: 0 },

    status:          { type: String, enum: ["draft", "scheduled", "in-progress", "completed", "cancelled"], default: "draft" },
    cancelledReason: { type: String },
    notes:           { type: String },
    createdBy:       { type: String }, // admin email, matching the statusChangedBy convention

    // The free-text pair this batch was backfilled from. Doubles as the
    // idempotency key for scripts/backfillBatches.js.
    legacyBatchDate: { type: Date },
    legacyBatchTime: { type: String },
  },
  { timestamps: true }
);

batchSchema.index({ instructorId: 1, status: 1, startDate: -1 });
batchSchema.index({ courseId: 1, startDate: -1 });
batchSchema.index({ courseTitle: 1, legacyBatchDate: 1, legacyBatchTime: 1 }, { sparse: true });

export default mongoose.model("Batch", batchSchema);
