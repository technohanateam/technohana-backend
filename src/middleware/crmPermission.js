// CRM role-based access control. Runs after authenticateCrm, so req.admin is set.
// Mirrored in technohana-crm/src/constants/crmConstants.js (CRM_PERMISSIONS) to
// hide UI the role can't use — keep the two in sync.

const CRM_PERMISSIONS = {
  leads: {
    read:   ["super_admin", "admin", "sales", "marketing", "readonly"],
    write:  ["super_admin", "admin", "sales", "marketing"],
    delete: ["super_admin", "admin"],
    import: ["super_admin", "admin", "sales"],
    // Sales exports are limited to their own leads in the handler.
    export: ["super_admin", "admin", "sales"],
    bulk:   ["super_admin", "admin", "sales"],
  },
  contacts: {
    read:   ["super_admin", "admin", "sales", "marketing", "readonly"],
    write:  ["super_admin", "admin", "sales", "marketing"],
    delete: ["super_admin", "admin"],
  },
  companies: {
    read:   ["super_admin", "admin", "sales", "marketing", "readonly"],
    write:  ["super_admin", "admin", "sales"],
    delete: ["super_admin", "admin"],
  },
  deals: {
    read:   ["super_admin", "admin", "sales", "readonly"],
    write:  ["super_admin", "admin", "sales"],
    delete: ["super_admin", "admin"],
  },
  pipelines: {
    read:   ["super_admin", "admin", "sales", "readonly"],
    write:  ["super_admin", "admin"],
    delete: ["super_admin", "admin"],
  },
  tasks: {
    read:   ["super_admin", "admin", "sales", "marketing"],
    write:  ["super_admin", "admin", "sales", "marketing"],
    delete: ["super_admin", "admin", "sales"],
  },
  activities: {
    read:   ["super_admin", "admin", "sales", "marketing", "readonly"],
    write:  ["super_admin", "admin", "sales", "marketing"],
  },
  dashboard: {
    read:   ["super_admin", "admin", "sales", "marketing", "hr", "readonly"],
  },
  // Ad spend is commercially sensitive, so it's narrower than the dashboard.
  ads: {
    read:   ["super_admin", "admin", "marketing"],
    // Connecting/disconnecting ad platforms (LinkedIn).
    write:  ["super_admin", "admin", "marketing"],
  },
  ai: {
    read:   ["super_admin", "admin", "sales"],
    write:  ["super_admin", "admin", "sales"],
  },
  tags: {
    read:   ["super_admin", "admin", "sales", "marketing", "readonly"],
    write:  ["super_admin", "admin", "sales", "marketing"],
    delete: ["super_admin", "admin"],
  },
  internships: {
    read:   ["super_admin", "admin", "sales", "marketing", "hr", "readonly"],
    write:  ["super_admin", "admin", "sales", "marketing", "hr"],
    delete: ["super_admin", "admin"],
  },
  // CRM team member management.
  users: {
    read:   ["super_admin", "admin"],
    write:  ["super_admin", "admin"],
    delete: ["super_admin", "admin"],
  },
};

export const hasCrmPermission = (role, resource, action = "read") =>
  (CRM_PERMISSIONS[resource]?.[action] || []).includes(role);

export function crmPermission(resource, action = "read") {
  return (req, res, next) => {
    const crmRole = req.admin?.crmRole;
    if (!crmRole) return res.status(401).json({ success: false, message: "Unauthorized" });

    if (!hasCrmPermission(crmRole, resource, action)) {
      return res.status(403).json({
        success: false,
        message: `Your role (${crmRole}) does not have ${action} access to ${resource}.`,
      });
    }

    req.crmRole = crmRole;
    next();
  };
}

// Shorthand guards
export const crmRead  = (resource) => crmPermission(resource, "read");
export const crmWrite = (resource) => crmPermission(resource, "write");
export const crmDelete = (resource) => crmPermission(resource, "delete");
export const crmBulk = (resource) => crmPermission(resource, "bulk");
export const crmImport = (resource) => crmPermission(resource, "import");
export const crmExport = (resource) => crmPermission(resource, "export");
