import mongoose, { Schema } from "mongoose";

// Slide types per the content-factory spec (§6).
const SLIDE_TYPES = [
  "title", "concept", "comparison", "process", "architecture",
  "diagram", "code", "example", "case-study", "quiz", "exercise",
  "summary", "transition",
];

// Deterministic diagram types the PPTX renderer knows how to draw (Priority
// 3) — structured data the AI supplies as WHAT to communicate; the renderer
// (src/services/courseFactory/pptxRenderers/) decides HOW it looks.
const DIAGRAM_TYPES = ["PROCESS", "CYCLE", "ARCHITECTURE", "COMPARISON", "FLOW", "HIERARCHY", "TIMELINE", "TABLE", "CODE"];

const diagramStepSchema = new Schema({ label: { type: String, required: true }, description: { type: String, default: "" } }, { _id: false });
const diagramColumnSchema = new Schema({ title: { type: String, required: true }, items: { type: [String], default: [] } }, { _id: false });
const diagramBoxSchema = new Schema({ label: { type: String, required: true }, description: { type: String, default: "" } }, { _id: false });

const diagramSchema = new Schema(
  {
    type: { type: String, enum: DIAGRAM_TYPES, required: true },
    steps: { type: [diagramStepSchema], default: undefined }, // PROCESS/CYCLE/FLOW/TIMELINE
    columns: { type: [diagramColumnSchema], default: undefined }, // COMPARISON
    boxes: { type: [diagramBoxSchema], default: undefined }, // ARCHITECTURE/HIERARCHY
    rows: { type: [[String]], default: undefined }, // TABLE — first row is the header
    code: { type: String, default: undefined }, // CODE
    language: { type: String, default: undefined }, // CODE
  },
  { _id: false }
);

const slideSchema = new Schema(
  {
    order: { type: Number, required: true },
    type: { type: String, enum: SLIDE_TYPES, required: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    bullets: { type: [String], default: [] },
    body: { type: String, default: "" },
    visualPrompt: { type: String, default: "" },
    diagram: { type: diagramSchema, default: null },
    speakerNotes: { type: String, default: "" },
    narration: { type: String, default: "" }, // must NOT just repeat slide text — QA checks this
    estimatedSeconds: { type: Number, default: 30 },
  },
  { _id: false }
);

const quizQuestionSchema = new Schema(
  {
    question: { type: String, required: true },
    type: { type: String, enum: ["multiple-choice", "multiple-select", "true-false", "scenario", "code-interpretation"], required: true },
    options: { type: [String], default: [] },
    correctAnswer: { type: Schema.Types.Mixed, required: true }, // index, array of indices, or boolean
    explanation: { type: String, default: "" },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
    learningObjective: { type: String, default: "" },
  },
  { _id: false }
);

const SOURCE_TYPES = ["official-docs", "blog", "paper", "other"];

// verificationStatus defaults to PENDING_VERIFICATION because this pipeline
// cannot itself browse the web to confirm a URL is real and current — only a
// human reviewer (or a future fact-check step) can set VERIFIED. A lesson
// with any non-VERIFIED technical source is flagged as not publish-ready by
// qaService.js, matching the "do not invent citations, do not mark verified
// unless actually checked" requirement.
const sourceSchema = new Schema(
  {
    title: { type: String, required: true },
    url: { type: String, required: true },
    publisher: { type: String, default: "" },
    type: { type: String, enum: SOURCE_TYPES, default: "other" },
    verificationStatus: { type: String, enum: ["VERIFIED", "PENDING_VERIFICATION"], default: "PENDING_VERIFICATION" },
    accessedAt: { type: Date, default: Date.now },
    // Who/when a human actually checked this source — only ever set by the
    // dedicated verify/unverify admin route, never by the generic lesson
    // PATCH or by generation itself.
    verifiedBy: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
  }
  // Real _ids (default) so the verify/unverify route can address a specific
  // source stably, rather than by array index.
);

const academyLessonSchema = new Schema(
  {
    moduleId: { type: Schema.Types.ObjectId, ref: "AcademyModule", required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: "AcademyCourse", required: true, index: true },
    slug: { type: String, required: true },
    order: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    durationMinutes: { type: Number, default: 15 },
    level: { type: String, enum: ["Foundational", "Intermediate", "Advanced"], default: "Intermediate" },
    learningObjectives: { type: [String], default: [] },
    prerequisites: { type: [String], default: [] },

    sections: { type: [Schema.Types.Mixed], default: [] },
    slides: { type: [slideSchema], default: [] },

    narration: {
      script: { type: String, default: "" },
      voice: { type: String, default: null },
      language: { type: String, default: "en-IN" },
      audioUrl: { type: String, default: null },
      audioPublicId: { type: String, default: null },
      durationSeconds: { type: Number, default: 0 },
    },

    quiz: { type: [quizQuestionSchema], default: [] },

    exercise: {
      title: { type: String, default: null },
      prompt: { type: String, default: null },
      expectedOutcome: { type: String, default: null },
    },

    lab: {
      title: { type: String, default: null },
      prerequisites: { type: [String], default: [] },
      environment: { type: String, default: null },
      instructions: { type: String, default: null },
      externalResourceUrl: { type: String, default: null }, // Colab/GitHub/Streamlit link only — no hosted sandbox in Phase 1
      solution: { type: String, default: null },
    },

    resources: { type: [String], default: [] },
    sources: { type: [sourceSchema], default: [] },

    instructorNotes: {
      teachingObjectives: { type: [String], default: [] },
      estimatedTeachingTime: { type: String, default: null },
      talkingPoints: { type: [String], default: [] },
      demos: { type: [String], default: [] },
      discussionQuestions: { type: [String], default: [] },
      commonMistakes: { type: [String], default: [] },
    },

    transcript: { type: String, default: "" },

    assets: {
      pptxUrl: { type: String, default: null },
      pptxPublicId: { type: String, default: null },
      pptxVersion: { type: Number, default: 0 },
    },

    // Denormalized for quick display (source of truth is still each
    // LessonGenerationJob's own step ledger) — approximate, admin-configurable
    // pricing, not exact provider billing.
    costUsd: {
      contentUsd: { type: Number, default: 0 },
      audioUsd: { type: Number, default: 0 },
      totalUsd: { type: Number, default: 0 },
    },

    qa: {
      qualityScore: { type: Number, default: null },
      issues: { type: [String], default: [] },
      publishReady: { type: Boolean, default: false },
      checkedAt: { type: Date, default: null },
    },

    status: { type: String, enum: ["DRAFT", "AI_REVIEWED", "HUMAN_REVIEW", "APPROVED", "PUBLISHED"], default: "DRAFT", index: true },
    version: { type: Number, default: 1 },

    approvedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

academyLessonSchema.index({ moduleId: 1, order: 1 });
academyLessonSchema.index({ courseId: 1, slug: 1 }, { unique: true });

const AcademyLesson = mongoose.model("AcademyLesson", academyLessonSchema);
export default AcademyLesson;
export { SLIDE_TYPES, DIAGRAM_TYPES, SOURCE_TYPES };
