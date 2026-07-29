import mongoose, { Schema } from "mongoose";

const seoAuditLogSchema = new Schema({
  actorAdminId: String,
  actorEmail: String,
  action: { type: String, required: true },
  entityType: String,
  entityId: String,
  metadata: Schema.Types.Mixed,
  ip: String,
  createdAt: { type: Date, default: Date.now, expires: 15552000 }, // 180 days
});

const SeoAuditLog = mongoose.model("SeoAuditLog", seoAuditLogSchema);
export default SeoAuditLog;
