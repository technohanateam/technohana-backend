import AuditLog from "../models/crm/auditLog.model.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("crmAudit");

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const buildAuditEntry = (req, statusCode) => {
  const segs = req.path.split("/").filter(Boolean);
  const resource = segs[0] || "crm";
  const resourceId = segs.find((s) => /^[a-f0-9]{24}$/i.test(s));
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  return {
    actorId: req.admin?.uid,
    actorRole: req.admin?.crmRole,
    realm: "crm",
    action: `${req.method} ${req.baseUrl}${req.path}`.slice(0, 200),
    method: req.method,
    path: `${req.baseUrl}${req.path}`.slice(0, 300),
    resource,
    resourceId,
    statusCode,
    changedFields: Object.keys(body).slice(0, 50),
    ip: req.ip,
    userAgent: req.get?.("user-agent"),
  };
};

// Records every successful CRM write (and any export) after the response is sent.
export function crmAudit(req, res, next) {
  if (!WRITE_METHODS.has(req.method) && !/export/i.test(req.path)) return next();
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    AuditLog.create(buildAuditEntry(req, res.statusCode)).catch((err) =>
      logger.error("audit log write failed:", err.message)
    );
  });
  next();
}
