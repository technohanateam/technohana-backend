import mongoose from "mongoose";

const moduleSchema = new mongoose.Schema(
  {
    moduleTitle: { type: String },
    content: [{ type: String }],
  },
  { _id: false }
);

const courseSchema = new mongoose.Schema({
  id:               { type: String },
  courseTitle:      { type: String, required: true },
  courseSlug:       { type: String },
  category:         { type: String },
  difficulty:       { type: String },
  price:            { type: String },
  instructor:       { type: String },
  language:         { type: String, default: "English" },
  courseDays:       { type: String },
  courseTime:       { type: String },
  courseModules:    { type: String },
  noStudents:       { type: String },
  rating:           { type: String },
  logo:             { type: String },
  toc:              { type: String },
  videoId:          { type: String },
  catcls:           { type: String },
  overview:         { type: String },
  courseObjective:  { type: String },
  courseOutcomes:   { type: String },
  labs:             { type: String },
  prerequisites:    [{ type: String }],
  whatWillYouLearn: [{ type: String }],
  requirements:     [{ type: String }],
  targetAudience:   [{ type: String }],
  modules:          [moduleSchema],
}, { timestamps: true });

courseSchema.index({ courseTitle: "text", category: "text", instructor: "text" });
courseSchema.index({ id: 1 });
courseSchema.index({ courseSlug: 1 });

export default mongoose.model("Course", courseSchema);
