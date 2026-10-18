import mongoose from "mongoose";

// Refreshed third-party access tokens (e.g. the Instagram long-lived token), kept
// out of env vars because the app rotates them itself.
const integrationTokenSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    tokenEncrypted: String,
    // Hash of the env token this chain was seeded from; a different env token means someone pasted a new one.
    seedHash: String,
    expiresAt: Date,
    refreshedAt: Date,
    failCount: { type: Number, default: 0 },
    lastError: String,
    lastAlertAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model("IntegrationToken", integrationTokenSchema);
