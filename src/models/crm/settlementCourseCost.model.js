import mongoose, { Schema } from "mongoose";

// Technohana's trainer cost per learner for one course, set by an admin. The settlement report
// applies it to each ad-lead learner once their batch is delivered. courseId is the catalog id
// stored on Order.courseId.
const settlementCourseCostSchema = new Schema(
  {
    courseId: { type: String, required: true, trim: true },
    currency: { type: String, required: true, uppercase: true, trim: true },
    courseTitle: { type: String, trim: true },
    costPerLearnerMinor: { type: Number, required: true, min: 0 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "CrmUser" },
  },
  { timestamps: true }
);

settlementCourseCostSchema.index({ courseId: 1, currency: 1 }, { unique: true });

export default mongoose.model("SettlementCourseCost", settlementCourseCostSchema);
