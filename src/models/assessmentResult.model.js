import mongoose from "mongoose";

const answerSchema = new mongoose.Schema({
  questionId:  { type: Number },
  selected:    { type: Number },
  correct:     { type: Number },
  isCorrect:   { type: Boolean },
}, { _id: false });

const questionSchema = new mongoose.Schema({
  id:           { type: Number },
  question:     { type: String },
  options:      [{ type: String }],
  correctIndex: { type: Number },
  explanation:  { type: String },
}, { _id: false });

const assessmentResultSchema = new mongoose.Schema({
  name:           { type: String, required: true, trim: true },
  email:          { type: String, required: true, trim: true, lowercase: true },
  phone:          { type: String, required: true, trim: true },
  courseId:       { type: String, trim: true },
  courseTitle:    { type: String, required: true, trim: true },
  category:       { type: String, trim: true },
  score:          { type: Number, required: true },
  totalQuestions: { type: Number, required: true },
  percentage:     { type: Number, required: true },
  answers:        [answerSchema],
  questions:      [questionSchema],
  completedAt:    { type: Date, default: Date.now },
}, { timestamps: true });

assessmentResultSchema.index({ email: 1 });
assessmentResultSchema.index({ courseId: 1 });
assessmentResultSchema.index({ completedAt: -1 });

export const AssessmentResult = mongoose.model("AssessmentResult", assessmentResultSchema);
