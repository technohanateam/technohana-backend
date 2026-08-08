import mongoose, { Schema } from "mongoose";

const seoTopicClusterSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, unique: true, sparse: true },
    pillarCategory: { type: String, required: true, index: true },
    description: { type: String },
    blogIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Blogs" }],
    // Courses live in a static frontend catalog (courses.json) keyed by their
    // short `id` (e.g. "FDA001"), not a Mongo _id — store that id, matching
    // how /courses/:courseId routing and the existing course-linker utils
    // already reference courses.
    courseIds: [{ type: String }],
    status: {
      type: String,
      enum: ["draft", "active", "archived"],
      default: "draft",
      index: true,
    },
  },
  { timestamps: true }
);

seoTopicClusterSchema.index({ pillarCategory: 1, status: 1 });

const SeoTopicCluster = mongoose.model("SeoTopicCluster", seoTopicClusterSchema);
export default SeoTopicCluster;
