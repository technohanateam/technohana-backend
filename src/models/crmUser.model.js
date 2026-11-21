import mongoose, { Schema } from "mongoose";

export const CRM_ROLES = ["super_admin", "admin", "sales", "marketing", "hr", "readonly"];

const crmUserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    crmRole: { type: String, enum: CRM_ROLES, required: true },
    title: { type: String, default: "", trim: true, maxlength: 100 },
    phone: { type: String, default: "", trim: true, maxlength: 40 },
    signature: { type: String, default: "", maxlength: 1000 },
    active: { type: Boolean, default: true },
    // "ads" reps work paid-ad leads (the poolLead gets them first and can hand them to the rest of the pool);
    // everyone else is in the direct pool that gets all other leads.
    leadPool: { type: String, enum: ["direct", "ads"], default: "direct" },
    poolLead: { type: Boolean, default: false },
    // Where the rep hears about newly assigned leads (email + in-app bell are always on unless email is switched off).
    notifyPrefs: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
    },
    pushSubscriptions: {
      type: [{
        endpoint: { type: String, required: true },
        keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
        userAgent: { type: String, default: "" },
        createdAt: { type: Date, default: Date.now },
      }],
      default: [],
      select: false,
    },
    lastLoginAt: { type: Date, default: null },
    resetTokenHash: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },
    // Bumped on password change, deactivation or role change; JWTs carrying an
    // older value are rejected, so those events end existing sessions.
    tokenVersion: { type: Number, default: 0 },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("CrmUser", crmUserSchema);
