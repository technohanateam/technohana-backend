import mongoose, { Schema } from "mongoose";

// Mirrors contentGenerationJob.model.js's per-step ledger pattern exactly,
// scoped to a single lesson's asset pipeline instead of a blog article.
const STEP_NAMES = ["CONTENT", "SLIDES", "NARRATION", "PPTX", "AUDIO", "QUIZ", "EXERCISE", "INSTRUCTOR_NOTES", "TRANSCRIPT", "QA"];

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

const lessonGenerationJobSchema = new Schema(
  {
    lessonId: { type: Schema.Types.ObjectId, ref: "AcademyLesson", required: true, index: true },

    status: { type: String, enum: ["QUEUED", "RUNNING", "AWAITING_INPUT", "AI_REVIEW", "DONE", "FAILED"], default: "QUEUED", index: true },

    steps: { type: [stepSchema], default: [] },

    // Manual Claude Pro workflow (mirrors contentGenerationJob.model.js's
    // pendingStep/pendingPrompts after fda0261 — ANTHROPIC_API_KEY has no
    // working billing). Set while status is AWAITING_INPUT; holds the CONTENT
    // step's prompt so the admin can copy it into Claude Pro and paste the
    // response back via /lessons/:id/resume-content.
    pendingStep: { type: String, enum: STEP_NAMES, default: null },
    pendingPrompts: {
      type: [{ label: { type: String, required: true }, system: { type: String, default: "" }, prompt: { type: String, required: true }, _id: false }],
      default: [],
    },

    retryCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },

    totalTokens: { type: Number, default: 0 },
    totalCostUsd: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const LessonGenerationJob = mongoose.model("LessonGenerationJob", lessonGenerationJobSchema);
export default LessonGenerationJob;
export { STEP_NAMES };
