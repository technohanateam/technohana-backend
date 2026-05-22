import mongoose, { Schema } from "mongoose";

const adminUserSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["admin", "sales", "marketing"], required: true },
  name: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

const AdminUser = mongoose.model("AdminUser", adminUserSchema);
export default AdminUser;
