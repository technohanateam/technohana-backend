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

// Two partial unique indexes instead of one: "date" dimensionType rows are a
// true per-day history and are unique per calendar day; every other
// dimensionType is a rolling-window snapshot with one current row per
// dimension value (no date in the key) — see gscSyncService.js.
seoGscMetricSchema.index(
  { propertyId: 1, dimensionType: 1, dimensionValue: 1, date: 1 },
  { unique: true, partialFilterExpression: { dimensionType: "date" } }
);
seoGscMetricSchema.index(
  { propertyId: 1, dimensionType: 1, dimensionValue: 1 },
  { unique: true, partialFilterExpression: { dimensionType: { $ne: "date" } } }
);
seoGscMetricSchema.index({ propertyId: 1, dimensionType: 1, date: -1 });

const SeoGscMetric = mongoose.model("SeoGscMetric", seoGscMetricSchema);
export default SeoGscMetric;
