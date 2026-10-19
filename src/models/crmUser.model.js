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
