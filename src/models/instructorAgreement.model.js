import mongoose, { Schema } from "mongoose";

const instructorAgreementSchema = new Schema({
  version: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  bodyHtml: { type: String, required: true },
  isActive: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

instructorAgreementSchema.index({ isActive: 1 });

const InstructorAgreement = mongoose.model("InstructorAgreement", instructorAgreementSchema);

export default InstructorAgreement;
