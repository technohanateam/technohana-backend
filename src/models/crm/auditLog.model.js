import mongoose from "mongoose";

// Append-only. There are intentionally no update or delete routes for this collection.
const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmUser", index: true },
    actorRole: { type: String },
    realm: { type: String, enum: ["crm", "admin", "instructor", "system"], default: "crm" },
    action: { type: String, required: true },
    method: { type: String },
    path: { type: String },
    resource: { type: String },
    resourceId: { type: String },
    statusCode: { type: Number },
    // Field names only, never values, so secrets and PII can't leak into the log.
    changedFields: [{ type: String }],
    ip: { type: String },
    userAgent: { type: String, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ resource: 1, resourceId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
