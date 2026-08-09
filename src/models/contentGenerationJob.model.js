import mongoose, { Schema } from "mongoose";

// REVISION is an M3 addition: appended to job.steps only when the automatic
// revision pass inside the QUALITY_GATE step actually runs — not part of the
// fixed pipeline order, so it's not always present.
const STEP_NAMES = ["BRIEF", "ARTICLE", "SEO", "LINKS", "IMAGE_PROMPT", "QUALITY_GATE", "REVISION"];

const stepSchema = new Schema(
  {
    name: { type: String, enum: STEP_NAMES, required: true },
    status: { type: String, enum: ["PENDING", "RUNNING", "DONE", "FAILED"], default: "PENDING" },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    model: { type: String, default: null },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    estimatedCostUsd: { type: Number, default: 0 },
    error: { type: String, default: null },
  },
  { _id: false }
);

const contentGenerationJobSchema = new Schema(
  {
    opportunityId: { type: Schema.Types.ObjectId, ref: "ContentOpportunity", required: true, index: true },
    briefId: { type: Schema.Types.ObjectId, ref: "ContentBrief", default: null },

    status: { type: String, enum: ["QUEUED", "RUNNING", "AI_REVIEW", "DONE", "FAILED"], default: "QUEUED", index: true },

    steps: { type: [stepSchema], default: [] },

    retryCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },

    totalTokens: { type: Number, default: 0 },
    totalCostUsd: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const ContentGenerationJob = mongoose.model("ContentGenerationJob", contentGenerationJobSchema);
export default ContentGenerationJob;
export { STEP_NAMES };
