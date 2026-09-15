import mongoose from "mongoose";

// One doc per Enquiry, generated on demand from the "Generate Prompts" admin
// action. Every prompt here is a copy-paste-into-Claude.ai-Pro workflow — this
// app never calls the Anthropic/OpenAI SDK for it (see
// enquiryPromptBuilder.service.js). The admin runs each prompt themselves and
// pastes the response back, which gets parsed and stored in `parsed`.
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
    enquiryId: { type: mongoose.Schema.Types.ObjectId, ref: "Enquiry", required: true, index: true },

    // Whether the enquiry's course was found in the Course catalog — drives
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

    socialPost: {
      ...promptItemFields,
      parsed: {
        caption: { type: String, default: null },
        hashtags: { type: [String], default: [] },
        cta: { type: String, default: null },
        imagePromptSuggestion: { type: String, default: null },
        altText: { type: String, default: null },
      },
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

enquiryPromptPackSchema.index({ enquiryId: 1 }, { unique: true });

export default mongoose.model("EnquiryPromptPack", enquiryPromptPackSchema);
