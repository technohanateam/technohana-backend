import mongoose, { Schema } from "mongoose";

// Singleton — always queried/updated via findOne({}) with no filter, one doc total.
const questionSchema = new Schema({
  id: { type: Number, required: true },
  question: { type: String, required: true },
  options: [{ type: String }],
  correctIndex: { type: Number, required: true },
}, { _id: false });

const instructorComplianceSettingsSchema = new Schema({
  passThresholdPercent: { type: Number, default: 80 },
  questions: [questionSchema],
  updatedAt: { type: Date, default: Date.now },
});

const InstructorComplianceSettings = mongoose.model("InstructorComplianceSettings", instructorComplianceSettingsSchema);

export default InstructorComplianceSettings;
