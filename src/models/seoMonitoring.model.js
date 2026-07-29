import mongoose, { Schema } from "mongoose";

const seoMonitoringSchema = new Schema({
  website: { type: String, required: true },
  targetPage: String,
  liveUrl: String,
  anchor: String,
  anchorText: String,
  follow: String,
  linkType: String,
  publishedDate: Date,
  lastChecked: Date,
  notes: String,

  linkStatus: {
    type: String,
    enum: ["live", "lost", "broken", "published", "pending-verification"],
    required: true,
    index: true,
  },

  sourceKey: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

seoMonitoringSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const SeoMonitoring = mongoose.model("SeoMonitoring", seoMonitoringSchema);
export default SeoMonitoring;
