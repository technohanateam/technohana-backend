import mongoose from "mongoose";

const SocialPostSchema = new mongoose.Schema(
  {
    platforms: [{ type: String, enum: ["linkedin-personal", "linkedin-company", "instagram", "facebook", "x"] }],
    text: { type: String, required: true },
    imageUrl: { type: String, default: "" },
    status: {
      type: String,
      enum: ["draft", "scheduled", "published", "failed"],
      default: "draft",
    },
    scheduledAt: { type: Date },
    publishedAt: { type: Date },
    bufferPostIds: [{ type: String }],
    utmParams: {
      source: String,
      medium: String,
      campaign: String,
      content: String,
    },
    metrics: {
      likes: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
    },
    createdBy: mongoose.Schema.Types.ObjectId,
    createdByRole: { type: String, enum: ["admin", "marketing", "sales"] },
  },
  { timestamps: true }
);

export default mongoose.model("SocialPost", SocialPostSchema);
