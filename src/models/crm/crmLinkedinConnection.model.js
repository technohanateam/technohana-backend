import mongoose from "mongoose";

// One org-wide LinkedIn Ads connection (singleton, unlike the per-rep Zoho one).
const crmLinkedinConnectionSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    encryptedTokens: { type: String, required: true },
    accessTokenExpiresAt: Date,
    refreshTokenExpiresAt: Date,
    scopes: [String],
    memberName: String,
    adAccountUrn: String,
    adAccountName: String,
    currency: String,
    isActive: { type: Boolean, default: true },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "CrmUser" },
    connectedAt: { type: Date, default: Date.now },
    lastLeadSyncAt: Date,
    lastSyncStatus: { type: String, enum: ["success", "error", "never"], default: "never" },
    lastSyncError: String,
  },
  { timestamps: true }
);

export default mongoose.model("CrmLinkedinConnection", crmLinkedinConnectionSchema);
