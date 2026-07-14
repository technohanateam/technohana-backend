import mongoose, { Schema } from "mongoose";

const adminUserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "sales", "marketing"], required: true },
    extraPages: { type: [String], default: [] },
    revokedPages: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    resetTokenHash: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("AdminUser", adminUserSchema);
