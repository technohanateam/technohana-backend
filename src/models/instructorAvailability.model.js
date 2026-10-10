import mongoose from "mongoose";

// One row per (instructor, date, slot).
//
// Chosen over date ranges because ranges need overlap-merge logic on every write
// and cannot be protected by a unique index, whereas per-day rows upsert trivially
// from a calendar UI and range-query on an index.
//
// There is deliberately no "booked" status: booked is DERIVED from Session/Batch at
// read time, never stored. Two sources of truth for the same fact is the bug this
// model exists to avoid.
//
// This supplements — does not replace — the free-text `Instructor.availability`
// string, which is prose written at application time ("weekends only, 2 weeks
// notice") and is still rendered on the admin Instructors page. Do not parse it.
const instructorAvailabilitySchema = new mongoose.Schema(
  {
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: "Instructor", required: true },
    // A date-only key, normalized to UTC midnight. Never a timestamp.
    date:         { type: Date, required: true },
    slot:         { type: String, enum: ["full-day", "morning", "afternoon", "evening"], default: "full-day" },
    status:       { type: String, enum: ["available", "unavailable", "tentative"], default: "available" },
    note:         { type: String },
    source:       { type: String, enum: ["instructor", "admin"], default: "instructor" },
  },
  { timestamps: true }
);

instructorAvailabilitySchema.index({ instructorId: 1, date: 1, slot: 1 }, { unique: true });
instructorAvailabilitySchema.index({ date: 1, status: 1 });

export default mongoose.model("InstructorAvailability", instructorAvailabilitySchema);
