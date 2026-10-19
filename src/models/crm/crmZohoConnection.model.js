import mongoose from "mongoose";

const crmZohoConnectionSchema = new mongoose.Schema(
  {
    crmUserId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmUser", required: true, unique: true },
    emailAddress: String,
    zohoMailAccountId: String,
    zohoMeetingZsoid: String,
    zohoMeetingZuid: String,
    encryptedRefreshToken: { type: String, required: true },
    scopes: [String],
    isActive: { type: Boolean, default: true },
    // The connection that owns the org's Zoho Meeting licence; used to create batch session links.
    isOrgDefault: { type: Boolean, default: false },
    connectedAt: { type: Date, default: Date.now },
    lastMailSyncAt: Date,
    lastMeetingSyncAt: Date,
    lastSyncStatus: { type: String, enum: ["success", "error", "never"], default: "never" },
    lastSyncError: String,
  },
  { timestamps: true }
);

export default mongoose.model("CrmZohoConnection", crmZohoConnectionSchema);
