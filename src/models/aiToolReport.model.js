import mongoose from "mongoose";

export const AI_TOOL_TYPES = ["skillsGap", "roadmap", "linkedinOptimizer", "contentCalendar", "interviewCoach"];

const aiToolReportSchema = new mongoose.Schema({
  email:      { type: String, required: true, trim: true, lowercase: true },
  toolType:   { type: String, enum: AI_TOOL_TYPES, required: true },
  title:      { type: String, required: true, trim: true },
  reportData: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt:  { type: Date, default: Date.now },
});

aiToolReportSchema.index({ email: 1, createdAt: -1 });

export const AiToolReport = mongoose.model("AiToolReport", aiToolReportSchema);
