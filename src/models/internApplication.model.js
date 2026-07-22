import mongoose, { Schema } from "mongoose";

const internApplicationSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String },
  department: { type: String, enum: ["sales", "marketing", "engineering", "design"], required: true },
  college: { type: String },
  degree: { type: String },
  graduationYear: { type: String },
  linkedinUrl: { type: String },
  portfolioUrl: { type: String },
  coverLetter: { type: String },
  availability: { type: String },
  duration: { type: String },
  resumeUrl: { type: String, required: true },
  resumePublicId: { type: String, required: true },
  status: {
    type: String,
    enum: ["applied", "shortlisted", "interviewing", "offered", "hired", "rejected"],
    default: "applied",
  },
  notes: { type: String, default: "" },
  assignedTo: { type: String, default: "" },
  nextFollowUp: { type: Date },
  statusChangedBy: { type: String, default: "" },
  statusChangedAt: { type: Date },
  source: { type: String, default: "website" },
  submittedAt: { type: Date, default: Date.now },
}, { timestamps: true });

internApplicationSchema.index({ email: 1 });
internApplicationSchema.index({ department: 1, status: 1 });
internApplicationSchema.index({ submittedAt: -1 });

const InternApplication = mongoose.model("InternApplication", internApplicationSchema);

export default InternApplication;
