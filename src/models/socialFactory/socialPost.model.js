import mongoose, { Schema } from "mongoose";

// Social Media Post Factory — turns an existing AcademyCourse or Blogs doc
// into a platform post via a MANUAL prompt/paste workflow (no Anthropic API
// call from this app; the admin runs the generated prompt in Claude.ai Pro
// themselves and pastes the response back). See socialPromptBuilder.service.js
// and socialPostParser.service.js.
const socialPostSchema = new Schema(
  {
    sourceType: { type: String, enum: ["COURSE", "BLOG", "OPPORTUNITY"], required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    sourceSlug: { type: String, default: null },
    sourceTitle: { type: String, default: null },

    platform: {
      type: String,
      enum: ["LINKEDIN", "INSTAGRAM", "X", "LINKEDIN_CAROUSEL", "INSTAGRAM_CAROUSEL", "WHATSAPP_STATUS"],
      required: true,
    },

    status: {
      type: String,
      enum: [
        "DRAFT",
        "PROMPT_GENERATED",
        "AWAITING_PASTE",
        "PARSED",
        "NEEDS_REVISION",
        "APPROVED",
        "SCHEDULED",
        "PUBLISHED",
        "REJECTED",
      ],
      default: "DRAFT",
      index: true,
    },

    generatedPrompt: {
      system: { type: String, default: null },
      prompt: { type: String, default: null },
      generatedAt: { type: Date, default: null },
    },

    pastedResponseRaw: { type: String, default: null },
    parseError: { type: String, default: null },

    post: {
      caption: { type: String, default: null },
      hashtags: { type: [String], default: [] },
      imagePromptSuggestion: { type: String, default: null },
      altText: { type: String, default: null },
      cta: { type: String, default: null },
      characterCount: { type: Number, default: 0 },
      // Populated only for LINKEDIN_CAROUSEL / INSTAGRAM_CAROUSEL — empty
      // array for every single-image platform.
      slides: {
        type: [{ heading: String, body: String, imagePromptSuggestion: String, _id: false }],
        default: [],
      },
    },

    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },

    scheduledAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

socialPostSchema.index({ status: 1, createdAt: -1 });
socialPostSchema.index({ scheduledAt: 1 });

const SocialPost = mongoose.model("SocialPost", socialPostSchema);
export default SocialPost;
