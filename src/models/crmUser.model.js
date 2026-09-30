import mongoose, { Schema } from "mongoose";

export const CRM_ROLES = ["super_admin", "admin", "sales", "marketing", "trainer", "accounts", "hr", "student_support", "readonly"];

const crmUserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    crmRole: { type: String, enum: CRM_ROLES, required: true },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    resetTokenHash: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("CrmUser", crmUserSchema);
