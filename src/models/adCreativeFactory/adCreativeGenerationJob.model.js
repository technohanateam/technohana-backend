import mongoose, { Schema } from "mongoose";

// REVISION is appended to job.steps only when the automatic revision pass
// inside COMPLIANCE_GATE actually runs — not part of the fixed pipeline
// order, so it's not always present. Mirrors contentGenerationJob.model.js.
const STEP_NAMES = ["BRIEF", "COPY_DRAFT", "PLATFORM_FIT", "COMPLIANCE_GATE", "REVISION"];

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

const adCreativeGenerationJobSchema = new Schema(
  {
    opportunityId: { type: Schema.Types.ObjectId, ref: "AdCreativeOpportunity", required: true, index: true },

    status: { type: String, enum: ["QUEUED", "RUNNING", "AWAITING_INPUT", "DONE", "FAILED"], default: "QUEUED", index: true },

    steps: { type: [stepSchema], default: [] },

    // Manual Claude Pro workflow: set while status is AWAITING_INPUT. Holds
    // the prompt(s) for the paused step so the admin can copy them into
    // Claude Pro and paste the response(s) back via submit-step.
    pendingStep: { type: String, enum: STEP_NAMES, default: null },
    pendingPrompts: {
      type: [{ label: { type: String, required: true }, system: { type: String, default: "" }, prompt: { type: String, required: true }, _id: false }],
      default: [],
    },
    // Disambiguates WHICH prompt COMPLIANCE_GATE is paused on — it can pause
    // for the optional brand-voice eval, or for a revision rewrite.
    pendingKind: { type: String, enum: ["BRAND_VOICE", "REVISION", "REVISION_STRONGER"], default: null },
    pendingComplianceResult: { type: Schema.Types.Mixed, default: null },
    pendingFirstRevision: { type: Schema.Types.Mixed, default: null },

    // Set from the generate request's skipBrandVoice. It has to live on the
    // job rather than stay a call argument: the pipeline always pauses for
    // the BRIEF and COPY_DRAFT prompts before COMPLIANCE_GATE is reached, and
    // each resume re-enters runSteps, so an argument-only flag never survives
    // to the step it governs.
    skipBrandVoice: { type: Boolean, default: false },

    retryCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },

    totalTokens: { type: Number, default: 0 },
    totalCostUsd: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const AdCreativeGenerationJob = mongoose.model("AdCreativeGenerationJob", adCreativeGenerationJobSchema);
export default AdCreativeGenerationJob;
export { STEP_NAMES };
