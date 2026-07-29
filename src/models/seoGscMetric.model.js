import mongoose, { Schema } from "mongoose";

const seoGscMetricSchema = new Schema({
  propertyId: { type: String, required: true },
  date: { type: Date, required: true },
  dimensionType: { type: String, enum: ["query", "page", "country", "device", "date"], required: true },
  dimensionValue: { type: String, required: true },
  clicks: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  ctr: { type: Number, default: 0 },
  position: { type: Number, default: 0 },
  syncedAt: { type: Date, default: Date.now },
});

seoGscMetricSchema.index(
  { propertyId: 1, date: 1, dimensionType: 1, dimensionValue: 1 },
  { unique: true }
);
seoGscMetricSchema.index({ propertyId: 1, dimensionType: 1, date: -1 });

const SeoGscMetric = mongoose.model("SeoGscMetric", seoGscMetricSchema);
export default SeoGscMetric;
