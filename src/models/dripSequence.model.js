import mongoose, { Schema } from "mongoose";

const dripStepSchema = new Schema(
  {
    stepNumber: { type: Number, required: true },
    name: { type: String, trim: true },
    subject: { type: String, required: true },
    htmlContent: { type: String, required: true },
    delayDays: { type: Number, default: 0, min: 0 },
    delayHours: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const dripSequenceSchema = new Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  triggerEvent: {
    type: String,
    required: true,
    enum: ["enrollment_complete", "referral_made", "payment_received", "enrollment_abandoned"],
  },
  steps: [dripStepSchema],
  fromName: { type: String, default: "Technohana" },
  fromEmail: { type: String, default: "noreply@technohana.in" },
  status: {
    type: String,
    enum: ["draft", "active", "inactive"],
    default: "draft",
  },
  createdBy: mongoose.Schema.Types.ObjectId,
  createdByRole: { type: String, enum: ["admin", "marketing"] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

dripSequenceSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const DripSequence = mongoose.model("DripSequence", dripSequenceSchema);
export default DripSequence;
