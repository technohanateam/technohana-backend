import mongoose, { Schema } from "mongoose";

// Slide types per the content-factory spec (§6).
const SLIDE_TYPES = [
  "title", "concept", "comparison", "process", "architecture",
  "diagram", "code", "example", "case-study", "quiz", "exercise",
  "summary", "transition",
];

const slideSchema = new Schema(
  {
    order: { type: Number, required: true },
    type: { type: String, enum: SLIDE_TYPES, required: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    bullets: { type: [String], default: [] },
    body: { type: String, default: "" },
    visualPrompt: { type: String, default: "" },
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

const sourceSchema = new Schema(
  {
    title: { type: String, required: true },
    url: { type: String, required: true },
    publisher: { type: String, default: "" },
    accessedAt: { type: Date, default: Date.now },
  },
  { _id: false }
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

    qa: {
      qualityScore: { type: Number, default: null },
      issues: { type: [String], default: [] },
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
export { SLIDE_TYPES };
