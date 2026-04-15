import mongoose from "mongoose";

const pipelineDraftSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ["quick_ops", "launch_campaign"],
      default: "quick_ops",
    },
    brief: {
      topic: { type: String, default: "" },
      category: { type: String, default: "" },
      trainingType: { type: String, enum: ["individual", "corporate"], default: "individual" },
      audiences: [{ type: String }],
      launchDate: { type: String, default: "" },
      offer: { type: String, default: "" },
      budget: { type: String, default: "" },
      ctaTemplate: { type: String, default: "Enroll now" },
      platforms: [{ type: String }],
    },
    creativePack: {
      selectedVariants: [{ type: String }],
      overrides: { type: mongoose.Schema.Types.Mixed, default: {} },
      exportedAssets: [{ id: String, label: String }],
    },
    socialPack: {
      posts: { type: mongoose.Schema.Types.Mixed, default: {} },
      schedule: {
        date: { type: String, default: "" },
        times: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
      utm: {
        name: { type: String, default: "" },
        source: { type: String, default: "" },
        medium: { type: String, default: "" },
        campaign: { type: String, default: "" },
        content: { type: String, default: "" },
      },
      validation: {
        charLimits: { type: mongoose.Schema.Types.Mixed, default: {} },
        missing: [{ type: String }],
      },
    },
    status: {
      type: String,
      enum: ["draft", "ready", "published", "failed"],
      default: "draft",
    },
    stageStatus: {
      brief: {
        type: String,
        enum: ["not_started", "in_progress", "ready", "published"],
        default: "not_started",
      },
      creatives: {
        type: String,
        enum: ["not_started", "in_progress", "ready", "published"],
        default: "not_started",
      },
      posts: {
        type: String,
        enum: ["not_started", "in_progress", "ready", "published"],
        default: "not_started",
      },
      publish: {
        type: String,
        enum: ["not_started", "in_progress", "ready", "published"],
        default: "not_started",
      },
    },
    publishedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId },
    createdByRole: { type: String, enum: ["admin", "marketing", "sales"] },
  },
  { timestamps: true }
);

export default mongoose.model("PipelineDraft", pipelineDraftSchema);
