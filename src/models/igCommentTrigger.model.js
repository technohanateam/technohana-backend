import mongoose from "mongoose";

// "Comment PYTHON on our post" → public reply + private DM with a link.
const igCommentTriggerSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    keywords: {
      type: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
      validate: (v) => v.length > 0,
    },
    // Empty = any post/Reel; otherwise only comments on these Instagram media ids.
    mediaIds: { type: [String], default: [] },
    replyText: { type: String, trim: true, maxlength: 300 },
    dmText: { type: String, required: true, trim: true, maxlength: 900 },
    linkUrl: { type: String, trim: true, maxlength: 500 },
    active: { type: Boolean, default: true, index: true },
    triggerCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("IgCommentTrigger", igCommentTriggerSchema);
