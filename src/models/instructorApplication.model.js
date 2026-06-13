import mongoose from "mongoose";

const instructorApplicationSchema = new mongoose.Schema({
  requirementId: { type: mongoose.Schema.Types.ObjectId, ref: "TrainingRequirement", required: true },
  instructorId:  { type: mongoose.Schema.Types.ObjectId, ref: "Instructor", required: true },
  proposedRate:  { type: String },
  coverLetter:   { type: String },
  availability:  { type: String },
  status:        { type: String, enum: ["applied", "shortlisted", "accepted", "rejected"], default: "applied" },
  submittedAt:   { type: Date, default: Date.now },
  respondedAt:   { type: Date },
  adminNotes:    { type: String },
}, { timestamps: true });

// One application per instructor per requirement
instructorApplicationSchema.index({ requirementId: 1, instructorId: 1 }, { unique: true });

export default mongoose.model("InstructorApplication", instructorApplicationSchema);
