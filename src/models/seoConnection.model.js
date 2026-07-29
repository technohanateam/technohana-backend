import mongoose, { Schema } from "mongoose";

const seoConnectionSchema = new Schema({
  provider: { type: String, enum: ["gsc", "ga4"], required: true },
  propertyId: { type: String, required: true },
  propertyLabel: String,
  encryptedRefreshToken: { type: String, required: true },
  scopes: [String],
  connectedByAdminId: String,
  connectedAt: { type: Date, default: Date.now },
  lastSyncedAt: Date,
  lastSyncStatus: { type: String, enum: ["success", "error", "never"], default: "never" },
  lastSyncError: String,
  isActive: { type: Boolean, default: true },
});

seoConnectionSchema.index({ provider: 1, propertyId: 1 }, { unique: true });

const SeoConnection = mongoose.model("SeoConnection", seoConnectionSchema);
export default SeoConnection;
