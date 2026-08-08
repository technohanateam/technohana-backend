import mongoose, { Schema } from "mongoose";

const headingSchema = new Schema({ level: { type: Number, default: 2 }, text: { type: String } }, { _id: false });
const courseLinkTargetSchema = new Schema({ courseSlug: { type: String }, reason: { type: String } }, { _id: false });
const blogLinkTargetSchema = new Schema({ blogId: { type: String }, reason: { type: String } }, { _id: false });

const contentBriefSchema = new Schema(
  {
    opportunityId: { type: Schema.Types.ObjectId, ref: "ContentOpportunity", required: true, unique: true },

    title: { type: String, required: true },
    searchIntent: { type: String, default: null },
    targetAudience: { type: String, default: null },

    primaryKeyword: { type: String, default: null },
    secondaryKeywords: { type: [String], default: [] },

    topicAngle: { type: String, default: null },
    headings: { type: [headingSchema], default: [] },
    questionsToAnswer: { type: [String], default: [] },
    suggestedExamples: { type: [String], default: [] },
    contentGaps: { type: [String], default: [] },

    internalLinkTargets: {
      courses: { type: [courseLinkTargetSchema], default: [] },
      blogs: { type: [blogLinkTargetSchema], default: [] },
    },

    courseId: { type: String, default: null },
    ctaRecommendation: { type: String, default: null },
    sourceRecommendations: { type: [String], default: [] },

    depthGuidance: { type: String, enum: ["SHORT", "STANDARD", "COMPREHENSIVE"], default: "STANDARD" },

    generatedByModel: { type: String, default: null },
  },
  { timestamps: true }
);

const ContentBrief = mongoose.model("ContentBrief", contentBriefSchema);
export default ContentBrief;
