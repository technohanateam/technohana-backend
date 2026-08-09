import mongoose, { Schema } from "mongoose";

const academyModuleSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: "AcademyCourse", required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    order: { type: Number, required: true },
    learningObjectives: { type: [String], default: [] },
    lessonIds: [{ type: Schema.Types.ObjectId, ref: "AcademyLesson" }],
  },
  { timestamps: true }
);

academyModuleSchema.index({ courseId: 1, order: 1 });

const AcademyModule = mongoose.model("AcademyModule", academyModuleSchema);
export default AcademyModule;
