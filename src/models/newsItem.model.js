import mongoose, { Schema } from "mongoose";

// News Radar — one row per AI-news headline pulled hourly from RSS feeds.
// Only headline, link and our own short summary are stored (never article
// body text). See services/newsRadar.service.js.
const newsItemSchema = new Schema(
  {
    url: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    source: { type: String, required: true },
    publishedAt: { type: Date, required: true, index: true },
    snippet: { type: String, default: null },

    // VIDEO items are official-channel uploads shown as link/embed only; we
    // keep the YouTube id and thumbnail URL, never the video or image bytes.
    kind: { type: String, enum: ["ARTICLE", "VIDEO"], default: "ARTICLE", index: true },
    videoId: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },

    heuristicScore: { type: Number, default: 0 },
    aiScore: { type: Number, default: null },
    whyItMatters: { type: String, default: null },
    angle: { type: String, default: null },
    scoredAt: { type: Date, default: null },

    // Local-only "Make video" re-edit (LOCAL_VIDEO_TOOLS). Rights must be confirmed
    // by an admin before any download; the render is a credited, branded cut.
    rightsConfirmedBy: { type: String, default: null },
    rightsNote: { type: String, default: null },
    rightsConfirmedAt: { type: Date, default: null },
    videoStatus: { type: String, enum: ["NONE", "RENDERING", "READY", "FAILED"], default: "NONE" },
    videoPath: { type: String, default: null },
    videoError: { type: String, default: null },

    breaking: { type: Boolean, default: false },
    status: { type: String, enum: ["NEW", "SHORTLISTED", "DRAFTED", "DISMISSED"], default: "NEW", index: true },
    socialPostIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true }
);

newsItemSchema.index({ status: 1, publishedAt: -1 });

const NewsItem = mongoose.model("NewsItem", newsItemSchema);
export default NewsItem;
