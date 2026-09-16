import mongoose from "mongoose";

// One doc per "Generate Prompts" admin action, either from an existing
// Enquiry row (source: "enquiry") or typed directly into the dashboard's
// partner-course modal (source: "partner", no Enquiry involved).
// trainerSearch/blogPost are copy-paste-into-Claude.ai-Pro workflows — this
// app never calls the Anthropic/OpenAI SDK for them (see
// enquiryPromptBuilder.service.js). The admin runs each prompt themselves
// and pastes the response back, which gets parsed and stored in `parsed`.
// socialPost instead delegates straight to the Social Media Post Factory
// (see socialPostCreation.service.js) — see the field comment below.
const promptItemFields = {
  status: { type: String, enum: ["PROMPT_GENERATED", "PARSED"], default: "PROMPT_GENERATED" },
  generatedPrompt: {
    system: { type: String, default: null },
    prompt: { type: String, default: null },
    generatedAt: { type: Date, default: null },
  },
  pastedResponseRaw: { type: String, default: null },
  parseError: { type: String, default: null },
  parsedAt: { type: Date, default: null },
};

const enquiryPromptPackSchema = new mongoose.Schema(
  {
    enquiryId: { type: mongoose.Schema.Types.ObjectId, ref: "Enquiry", default: null, index: true },
    source: { type: String, enum: ["enquiry", "partner"], default: "enquiry" },
    // Only set when source === "partner" — the course name/partner typed
    // into the dashboard's "Generate Prompts" modal (no Enquiry doc exists).
    partnerCourseTitle: { type: String, default: null },
    partnerName: { type: String, default: null },
    createdBy: { type: String, default: null },

    // Whether the (enquiry's or partner-typed) course was found in the Course catalog — drives
    // whether the frontend offers "Create manually" / "Create from AI draft"
    // course-creation shortcuts. This pack never creates a Course itself.
    courseMatch: {
      found: { type: Boolean, default: false },
      courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", default: null },
      courseTitle: { type: String, default: null },
    },

    trainerSearch: {
      ...promptItemFields,
      parsed: {
        postText: { type: String, default: null },
      },
    },

    // Delegated to the Social Media Post Factory instead of being generated
    // and pasted-back here: when a course matches, a real SocialPost doc is
    // created (status AWAITING_PASTE) and referenced by id, so it can be
    // reviewed/approved/scheduled through the existing Factory UI. Left null
    // when no course matches (nothing to post about yet).
    socialPost: {
      socialPostId: { type: mongoose.Schema.Types.ObjectId, ref: "SocialPost", default: null },
    },

    blogPost: {
      ...promptItemFields,
      parsed: {
        title: { type: String, default: null },
        content: { type: String, default: null },
        excerpt: { type: String, default: null },
        metaTitle: { type: String, default: null },
        metaDescription: { type: String, default: null },
        focusKeyword: { type: String, default: null },
        tags: { type: [String], default: [] },
      },
      // Set once the parsed draft is saved as a Blogs doc (published: false).
      blogId: { type: mongoose.Schema.Types.ObjectId, ref: "Blogs", default: null },
    },
  },
  { timestamps: true }
);

enquiryPromptPackSchema.index({ enquiryId: 1 }, { unique: true, sparse: true });

export default mongoose.model("EnquiryPromptPack", enquiryPromptPackSchema);
