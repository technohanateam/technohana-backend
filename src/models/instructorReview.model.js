import mongoose, { Schema } from "mongoose";
import Instructor from "./instructor.js";

const instructorReviewSchema = new Schema({
  instructorId: { type: Schema.Types.ObjectId, ref: "Instructor", required: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  enrollmentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  studentEmail: { type: String, required: true },
  studentName: { type: String, default: "" },
  rating: { type: Number, required: true, min: 1, max: 5 },
  reviewText: { type: String, default: "" },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
});

instructorReviewSchema.index({ instructorId: 1, studentEmail: 1, courseId: 1 }, { unique: true });
instructorReviewSchema.index({ instructorId: 1, status: 1, createdAt: -1 });

const InstructorReview = mongoose.model("InstructorReview", instructorReviewSchema);

export const recomputeInstructorRating = async (instructorId) => {
  const approved = await InstructorReview.find({ instructorId, status: "approved" }).select("rating").lean();
  const reviewCount = approved.length;
  const avgRating = reviewCount ? approved.reduce((sum, r) => sum + r.rating, 0) / reviewCount : 0;
  await Instructor.findByIdAndUpdate(instructorId, {
    avgRating: Math.round(avgRating * 10) / 10,
    reviewCount,
  });
};

export default InstructorReview;
