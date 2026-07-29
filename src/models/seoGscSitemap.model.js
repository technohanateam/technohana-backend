import mongoose, { Schema } from "mongoose";

const seoGscSitemapSchema = new Schema({
  propertyId: { type: String, required: true },
  path: { type: String, required: true },
  lastSubmitted: Date,
  lastDownloaded: Date,
  isPending: Boolean,
  isSitemapsIndex: Boolean,
  warnings: Number,
  errors: Number,
  contents: [
    {
      type: String,
      submitted: Number,
      indexed: Number,
    },
  ],
  syncedAt: { type: Date, default: Date.now },
});

seoGscSitemapSchema.index({ propertyId: 1, path: 1 }, { unique: true });

const SeoGscSitemap = mongoose.model("SeoGscSitemap", seoGscSitemapSchema);
export default SeoGscSitemap;
