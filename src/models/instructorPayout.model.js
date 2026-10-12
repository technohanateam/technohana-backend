import mongoose, { Schema } from "mongoose";

// One delivered session a payout pays for, priced at the batch rate when requested.
const payoutLineSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "Session", required: true },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
    batchCode: { type: String },
    courseTitle: { type: String },
    startsAt: { type: Date },
    minutes: { type: Number, required: true },
    rateMinor: { type: Number, required: true }, // per hour
    amountMinor: { type: Number, required: true }, // gross
  },
  { _id: false }
);

const instructorPayoutSchema = new Schema({
  instructorId: { type: Schema.Types.ObjectId, ref: "Instructor", required: true },
  amountMinor: { type: Number, required: true },
  currency: { type: String, required: true },
  periodStart: { type: Date },
  periodEnd: { type: Date },
  // Ledger payouts (ledger: true) claim specific sessions; earlier payouts were a bare
  // amount. amountMinor = grossMinor - tdsMinor - absorbedLegacyMinor.
  ledger: { type: Boolean, default: false },
  lines: { type: [payoutLineSchema], default: undefined },
  grossMinor: { type: Number },
  tdsPercent: { type: Number },
  tdsMinor: { type: Number },
  // Pre-ledger payout amounts netted off this claim (negative pays back a pre-ledger
  // payout that was rejected after being netted off).
  absorbedLegacyMinor: { type: Number, default: 0 },
  // The instructorId while requested/approved/processing; unset otherwise. The unique
  // index allows one open ledger request per trainer.
  openKey: { type: String },
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
instructorPayoutSchema.index({ openKey: 1 }, { unique: true, sparse: true });
instructorPayoutSchema.index({ "lines.sessionId": 1 }, { sparse: true });

const InstructorPayout = mongoose.model("InstructorPayout", instructorPayoutSchema);

export default InstructorPayout;
