import mongoose, { Schema } from "mongoose";

const answerSchema = new Schema({
  questionId: { type: Number },
  selected: { type: Number },
  isCorrect: { type: Boolean },
}, { _id: false });

const instructorComplianceQuizSchema = new Schema({
  instructorId: { type: Schema.Types.ObjectId, ref: "Instructor", required: true },
  answers: [answerSchema],
  score: { type: Number, required: true },
  totalQuestions: { type: Number, required: true },
  percentage: { type: Number, required: true },
  passed: { type: Boolean, required: true },
  attemptNumber: { type: Number, required: true },
  completedAt: { type: Date, default: Date.now },
});

instructorComplianceQuizSchema.index({ instructorId: 1, completedAt: -1 });

const InstructorComplianceQuiz = mongoose.model("InstructorComplianceQuiz", instructorComplianceQuizSchema);

export default InstructorComplianceQuiz;
