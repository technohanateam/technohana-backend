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
  // GA4 has no "list my properties" call under analytics.readonly scope
  // alone, so after OAuth consent the admin must enter the numeric property
  // ID separately. `pendingSelection` marks a stub awaiting that step —
  // `propertyId` for these stubs is a per-flow-unique placeholder (not the
  // literal "pending"), so two connect flows in flight at once can't
  // overwrite each other's stored refresh token.
  pendingSelection: { type: Boolean, default: false },
});

seoConnectionSchema.index({ provider: 1, propertyId: 1 }, { unique: true });

const SeoConnection = mongoose.model("SeoConnection", seoConnectionSchema);
export default SeoConnection;
