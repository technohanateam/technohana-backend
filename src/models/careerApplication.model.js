import mongoose from "mongoose";

const careerApplicationSchema = new mongoose.Schema({
  requirementId:  { type: mongoose.Schema.Types.ObjectId, ref: "TrainingRequirement", required: true },
  name:           { type: String, required: true },
  email:          { type: String, required: true },
  phone:          { type: String },
  expertise:      { type: String },
  coverLetter:    { type: String },
  resumeUrl:      { type: String, required: true },
  resumePublicId: { type: String },
  status:         { type: String, enum: ["applied", "shortlisted", "accepted", "rejected"], default: "applied" },
  submittedAt:    { type: Date, default: Date.now },
  respondedAt:    { type: Date },
  adminNotes:     { type: String },
}, { timestamps: true });

export default mongoose.model("CareerApplication", careerApplicationSchema);
