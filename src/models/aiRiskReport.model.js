import mongoose from "mongoose";

const answerSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    risk: { type: String, enum: ["Low", "Medium", "High"], required: true },
    points: { type: Number, required: true },
  },
  { _id: false }
);

const aiRiskReportSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, default: "" },
  source: { type: String, default: "AI Career Risk Test" },
  score: { type: Number, required: true },
  band: { type: String, enum: ["Low Risk", "Medium Risk", "High Risk"], required: true },
  explanation: { type: String, required: true },
  answers: { type: Map, of: answerSchema, required: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("AiRiskReport", aiRiskReportSchema);
