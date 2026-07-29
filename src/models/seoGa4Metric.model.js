import mongoose, { Schema } from "mongoose";

const seoGa4MetricSchema = new Schema({
  propertyId: { type: String, required: true },
  date: { type: Date, required: true },
  dimensionType: {
    type: String,
    enum: ["landingPage", "event", "trafficSource", "device", "country", "date"],
    required: true,
  },
  dimensionValue: { type: String, required: true },
  sessions: { type: Number, default: 0 },
  users: { type: Number, default: 0 },
  newUsers: { type: Number, default: 0 },
  engagedSessions: { type: Number, default: 0 },
  engagementRate: { type: Number, default: 0 },
  avgEngagementTime: { type: Number, default: 0 },
  bounceRate: { type: Number, default: 0 },
  conversions: { type: Number, default: 0 },
  eventCount: { type: Number, default: 0 },
  syncedAt: { type: Date, default: Date.now },
});

seoGa4MetricSchema.index(
  { propertyId: 1, date: 1, dimensionType: 1, dimensionValue: 1 },
  { unique: true }
);
seoGa4MetricSchema.index({ propertyId: 1, dimensionType: 1, date: -1 });

const SeoGa4Metric = mongoose.model("SeoGa4Metric", seoGa4MetricSchema);
export default SeoGa4Metric;
