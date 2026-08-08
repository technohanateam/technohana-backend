import mongoose, { Schema } from "mongoose";

const topicClusterSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    categories: { type: [String], default: [] },
    priority: { type: Number, default: 50 },
    // Milestone 5: last time trendResearch.service.js ran a real research
    // call for this cluster — used to prioritize which clusters get a call
    // when there are more clusters than maxDailyResearchCalls allows in one
    // run (least-recently-researched first, after priority desc).
    lastResearchedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const TopicCluster = mongoose.model("TopicCluster", topicClusterSchema);
export default TopicCluster;
