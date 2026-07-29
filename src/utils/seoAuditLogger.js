import SeoAuditLog from "../models/seoAuditLog.model.js";

export async function logSeoAudit(req, action, entityType, entityId, metadata = {}) {
  try {
    await SeoAuditLog.create({
      actorAdminId: req.admin?.uid,
      actorEmail: req.admin?.email,
      action,
      entityType,
      entityId,
      metadata,
      ip: req.ip,
    });
  } catch (e) {
    console.error("[SeoAuditLog] failed:", e.message);
  }
}
