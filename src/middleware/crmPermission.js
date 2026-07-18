// CRM role-based access control middleware.
// Sits after authenticateAdmin — req.admin is guaranteed to be set.

const CRM_ROLE_HIERARCHY = {
  super_admin: 100,
  admin: 90,
  sales: 70,
  marketing: 60,
  trainer: 50,
  accounts: 40,
  hr: 30,
  student_support: 20,
  readonly: 10,
};

// Permissions matrix: which roles can perform which actions
const CRM_PERMISSIONS = {
  leads: {
    read:   ["super_admin", "admin", "sales", "marketing", "student_support", "readonly"],
    write:  ["super_admin", "admin", "sales", "marketing"],
    delete: ["super_admin", "admin"],
    import: ["super_admin", "admin", "sales"],
    export: ["super_admin", "admin", "sales", "marketing"],
    bulk:   ["super_admin", "admin", "sales"],
  },
  contacts: {
    read:   ["super_admin", "admin", "sales", "marketing", "student_support", "readonly"],
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
    read:   ["super_admin", "admin", "sales", "marketing", "trainer", "student_support"],
    write:  ["super_admin", "admin", "sales", "marketing", "trainer"],
    delete: ["super_admin", "admin", "sales"],
  },
  activities: {
    read:   ["super_admin", "admin", "sales", "marketing", "trainer", "student_support", "readonly"],
    write:  ["super_admin", "admin", "sales", "marketing", "trainer"],
  },
  dashboard: {
    read:   ["super_admin", "admin", "sales", "marketing", "trainer", "accounts", "hr", "student_support", "readonly"],
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
};

// Extend existing admin roles for CRM context.
// Maps legacy 3-role system to CRM roles gracefully.
const legacyRoleMap = {
  admin: "admin",
  sales: "sales",
  marketing: "marketing",
};

export function crmPermission(resource, action = "read") {
  return (req, res, next) => {
    const admin = req.admin;
    if (!admin) return res.status(401).json({ success: false, message: "Unauthorized" });

    // Resolve CRM role (supports both new RBAC enum and legacy 3-role system)
    const crmRole = admin.crmRole || legacyRoleMap[admin.role] || admin.role;

    const allowed = CRM_PERMISSIONS[resource]?.[action] || [];
    if (!allowed.includes(crmRole)) {
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
