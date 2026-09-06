import mongoose, { Schema } from "mongoose";

const instructorAgreementAcceptanceSchema = new Schema({
  instructorId: { type: Schema.Types.ObjectId, ref: "Instructor", required: true },
  agreementVersion: { type: String, required: true },
  typedFullName: { type: String, required: true },
  ipAddress: { type: String, default: "" },
  acceptedAt: { type: Date, default: Date.now },
});

instructorAgreementAcceptanceSchema.index({ instructorId: 1, agreementVersion: 1 }, { unique: true });

const InstructorAgreementAcceptance = mongoose.model("InstructorAgreementAcceptance", instructorAgreementAcceptanceSchema);

export default InstructorAgreementAcceptance;
