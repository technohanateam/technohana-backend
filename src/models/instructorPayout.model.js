import mongoose, { Schema } from "mongoose";

const instructorPayoutSchema = new Schema({
  instructorId: { type: Schema.Types.ObjectId, ref: "Instructor", required: true },
  amountMinor: { type: Number, required: true },
  currency: { type: String, required: true },
  periodStart: { type: Date },
  periodEnd: { type: Date },
  status: { type: String, enum: ["requested", "approved", "processing", "paid", "rejected"], default: "requested" },
  payoutMethod: { type: String, enum: ["bank", "upi"] },
  payoutLastFour: { type: String, default: "" },
  // Frozen snapshot of payoutDetailsEncrypted at request time — later profile edits never
  // retroactively change a past request's payout instructions.
  payoutDetailsSnapshotEncrypted: { type: String },
  adminNotes: { type: String, default: "" },
  paymentReference: { type: String, default: "" },
  requestedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  processedBy: { type: String, default: "" },
});

instructorPayoutSchema.index({ instructorId: 1, status: 1 });
instructorPayoutSchema.index({ status: 1, requestedAt: -1 });

const InstructorPayout = mongoose.model("InstructorPayout", instructorPayoutSchema);

export default InstructorPayout;
