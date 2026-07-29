import mongoose, { Schema } from "mongoose";

const seoAlertSchema = new Schema({
  type: {
    type: String,
    enum: [
      "traffic_drop",
      "ranking_drop",
      "crawl_error_spike",
      "new_broken_link",
      "indexing_issue",
      "ctr_drop",
      "sitemap_change",
    ],
    required: true,
  },
  severity: { type: String, enum: ["critical", "warning", "info"], required: true },
  title: { type: String, required: true },
  description: String,
  metricBefore: Number,
  metricAfter: Number,
  changePercent: Number,
  relatedUrl: String,
  relatedQuery: String,
  triggeredAt: { type: Date, default: Date.now, index: true },
  acknowledged: { type: Boolean, default: false },
  acknowledgedBy: String,
  acknowledgedAt: Date,
  emailSent: { type: Boolean, default: false },
});

const SeoAlert = mongoose.model("SeoAlert", seoAlertSchema);
export default SeoAlert;
