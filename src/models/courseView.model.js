import mongoose from "mongoose";

const { Schema } = mongoose;

const courseViewSchema = new Schema({
  courseId: { type: String, required: true, index: true },
  courseTitle: { type: String },
  userEmail: { type: String, default: null },
  country: { type: String, default: null },
  currency: { type: String, default: null },
  viewedAt: { type: Date, default: Date.now },
});

export const CourseView = mongoose.model("CourseView", courseViewSchema);
