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

    status: { type: String, enum: ["QUEUED", "RUNNING", "AWAITING_INPUT", "AI_REVIEW", "DONE", "FAILED"], default: "QUEUED", index: true },

    steps: { type: [stepSchema], default: [] },

    // Manual Claude Pro workflow: set while status is AWAITING_INPUT. Holds
    // the prompt(s) for the paused step so the admin can copy them into
    // Claude Pro and paste the response(s) back via submit-step.
    pendingStep: { type: String, enum: STEP_NAMES, default: null },
    pendingPrompts: {
      type: [{ label: { type: String, required: true }, system: { type: String, default: "" }, prompt: { type: String, required: true }, _id: false }],
      default: [],
    },
    // Disambiguates WHICH prompt(s) a QUALITY_GATE pause is waiting on — it
    // pauses twice for different reasons (the initial fact-check/AI-style/
    // quality-eval trio, vs. a single automatic-revision rewrite prompt) and
    // resumeStep needs to know which parsing path to take for the pasted
    // response(s). Unused for the other steps (each of those only ever
    // pauses one way).
    pendingKind: { type: String, enum: ["CHECKS", "REVISION", "REVISION_STRONGER"], default: null },
    // Transient state needed across a pause/resume round trip for the LINKS
    // step (candidate courses/blogs to validate the pasted response against)
    // and the QUALITY_GATE step (the gate result being revised, so a second
    // "stronger rewrite" pause doesn't need to recompute it). Cleared once
    // the step completes.
    pendingLinkCandidates: { type: Schema.Types.Mixed, default: null },
    pendingQualityGateResult: { type: Schema.Types.Mixed, default: null },
    // The first revision attempt's { revised, similarity } — kept only while
    // waiting on a REVISION_STRONGER pause, so the second attempt can be
    // compared against it without re-parsing. Cleared once resolved.
    pendingFirstRevision: { type: Schema.Types.Mixed, default: null },

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
