import mongoose from "mongoose";

const trainingRequirementSchema = new mongoose.Schema({
  title:        { type: String, required: true },
  description:  { type: String, required: true },
  topic:        { type: String },
  expertise:    { type: String },
  deliveryMode: { type: String, enum: ["online", "onsite", "hybrid"] },
  duration:     { type: String },
  participants: { type: Number },
  budgetRange:  { type: String },
  startDate:    { type: Date },
  deadline:     { type: Date },
  location:     { type: String },
  status:       { type: String, enum: ["open", "closed", "filled"], default: "open" },
  postedBy:     { type: String },
  notifiedCount: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model("TrainingRequirement", trainingRequirementSchema);
