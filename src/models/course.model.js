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
  prices: {
    inr: { type: Number },
    usd: { type: Number },
    aed: { type: Number },
    gbp: { type: Number },
    eur: { type: Number },
  },
  instructor:       { type: String },
  instructorId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Instructor', sparse: true },
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
  categoryGroup:    { type: String },
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

// Mongo allows only one text index per collection — deploying this change
// requires dropping the prior {courseTitle, category, instructor} text index
// first (e.g. db.courses.dropIndex("courseTitle_text_category_text_instructor_text"))
// so Mongoose can create this wider one without erroring on boot.
courseSchema.index({
  courseTitle: "text",
  category: "text",
  instructor: "text",
  overview: "text",
  courseObjective: "text",
  courseOutcomes: "text",
  whatWillYouLearn: "text",
  targetAudience: "text",
  prerequisites: "text",
});
courseSchema.index({ id: 1 });
courseSchema.index({ courseSlug: 1 });

export default mongoose.model("Course", courseSchema);
