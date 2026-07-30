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

  // Phase 6 — automated verification fields
  opportunityId: { type: Schema.Types.ObjectId, ref: "SeoOpportunity" },
  dofollow: Boolean,
  httpStatus: Number,
  redirectedTo: String,
  anchorTextObserved: String,
  anchorTextChanged: Boolean,
  verificationMethod: { type: String, enum: ["manual", "automated-fetch"], default: "manual" },
  lastVerificationError: String,
  consecutiveFailedChecks: { type: Number, default: 0 },

  sourceKey: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

seoMonitoringSchema.index({ lastChecked: 1, linkStatus: 1 });

seoMonitoringSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const SeoMonitoring = mongoose.model("SeoMonitoring", seoMonitoringSchema);
export default SeoMonitoring;
