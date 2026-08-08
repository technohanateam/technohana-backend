import mongoose, { Schema } from "mongoose";

const topicClusterSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    categories: { type: [String], default: [] },
    priority: { type: Number, default: 50 },
  },
  { timestamps: true }
);

const TopicCluster = mongoose.model("TopicCluster", topicClusterSchema);
export default TopicCluster;
