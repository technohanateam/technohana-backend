import mongoose, { Schema } from "mongoose";

// Canonical AI Academy course — deliberately NOT stored on course.model.js
// (the marketing/enrollment catalog), which is overwritten wholesale by
// `npm run sync-prices`. Keyed by its own `slug`, independent lifecycle.
const academyCourseSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
    description: { type: String, default: "" },
    category: { type: String, default: "" },
    level: { type: String, enum: ["Foundational", "Intermediate", "Advanced"], default: "Intermediate" },
    audience: { type: String, default: "" },
    estimatedHours: { type: Number, default: 0 },
    prerequisites: { type: [String], default: [] },
    learningObjectives: { type: [String], default: [] },
    skills: { type: [String], default: [] },

    moduleIds: [{ type: Schema.Types.ObjectId, ref: "AcademyModule" }],

    capstone: {
      title: { type: String, default: null },
      description: { type: String, default: null },
      deliverable: { type: String, default: null },
    },

    certification: {
      alignedTo: { type: String, default: null }, // e.g. "Microsoft AB-100" — only set once verified
      examObjectives: { type: [String], default: [] },
    },

    // Blueprint generation inputs — kept for regeneration/audit, not shown to learners.
    blueprintInput: {
      audience: { type: String, default: null },
      level: { type: String, default: null },
      durationHours: { type: Number, default: null },
      moduleCount: { type: Number, default: null },
      lessonsPerModule: { type: Number, default: null },
      technology: { type: String, default: null },
      teachingStyle: { type: String, default: null },
    },

    status: { type: String, enum: ["DRAFT", "APPROVED", "PUBLISHED"], default: "DRAFT", index: true },
    version: { type: Number, default: 1 },

    // Approximate, admin-configurable pricing — not exact provider billing.
    blueprintCostUsd: { type: Number, default: 0 },

    createdBy: { type: String, default: null },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const AcademyCourse = mongoose.model("AcademyCourse", academyCourseSchema);
export default AcademyCourse;
