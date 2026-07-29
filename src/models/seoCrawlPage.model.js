import mongoose, { Schema } from "mongoose";

const seoCrawlPageSchema = new Schema({
  crawlRunId: { type: Schema.Types.ObjectId, ref: "SeoCrawlRun", required: true, index: true },
  url: { type: String, required: true },
  statusCode: Number,
  redirectedTo: String,
  title: String,
  titleLength: Number,
  metaDescription: String,
  metaDescriptionLength: Number,
  h1Tags: [String],
  h2Count: Number,
  canonicalUrl: String,
  isNoindex: Boolean,
  wordCount: Number,
  loadTimeMs: Number,
  internalLinks: [String],
  externalLinks: [String],
  brokenLinks: [String],
  images: [
    {
      src: String,
      alt: String,
      sizeBytes: Number,
    },
  ],
  issues: [String],
  crawledAt: { type: Date, default: Date.now },
});

seoCrawlPageSchema.index({ crawlRunId: 1, url: 1 }, { unique: true });
seoCrawlPageSchema.index({ url: 1, crawledAt: -1 });

const SeoCrawlPage = mongoose.model("SeoCrawlPage", seoCrawlPageSchema);
export default SeoCrawlPage;
