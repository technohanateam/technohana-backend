import jwt from "jsonwebtoken";
import AdminUser from "../models/adminUser.model.js";
import { DEFAULT_PAGES_BY_ROLE } from "../constants/adminPages.js";

// Roles that only make sense inside the CRM — accounts assigned one of these
// must never get admin-panel access, regardless of their legacy `role`.
// super_admin included so a CRM-only owner (full CRM control) never gets
// admin-panel access just because their legacy `role` defaults to admin pages.
const CRM_ONLY_ROLES = ["super_admin", "trainer", "accounts", "hr", "student_support", "readonly"];

export const authenticateAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Access denied, no token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET);

    // Tokens issued before page-level access existed carry only a role
    if (!payload.pages) {
      payload.pages = DEFAULT_PAGES_BY_ROLE[payload.role] || [];
    }

    // DB-backed accounts can be deactivated mid-session — enforce immediately
    if (payload.uid) {
      const account = await AdminUser.findById(payload.uid).select("active").lean();
      if (!account || !account.active) {
        return res.status(401).json({ message: "Account deactivated" });
      }
    }

    // req.baseUrl reflects the mount path ("/admin" vs "/api/crm") of whichever
    // router this middleware is running inside of — safe to gate on here since
    // it's the same shared middleware for both surfaces.
    if (req.baseUrl.startsWith("/admin") && CRM_ONLY_ROLES.includes(payload.crmRole)) {
      return res.status(403).json({ message: "This account is CRM-only and cannot access the admin panel." });
    }

    // Only the legacy "admin" role may reach the admin panel — sales/CRM accounts
    // belong in /crm with a crmRole, not in /admin with a legacy role.
    if (req.baseUrl.startsWith("/admin") && payload.role !== "admin") {
      return res.status(403).json({ message: "This account cannot access the admin panel." });
    }

    req.admin = payload;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired admin token" });
  }
};

// Requires full admin role — blocks sales and marketing roles from destructive operations
export const requireAdmin = (req, res, next) => {
  if (req.admin?.role !== "admin" && req.admin?.crmRole !== "super_admin") {
    return res.status(403).json({ message: "Access denied. Admin role required." });
  }
  next();
};

// Requires admin or marketing role — blocks sales role from marketing operations
export const requireMarketing = (req, res, next) => {
  if (!["admin", "marketing"].includes(req.admin?.role)) {
    return res.status(403).json({ message: "Access denied. Marketing role required." });
  }
  next();
};

// Requires access to at least one of the given admin pages (per-user effective pages)
export const requirePage = (...pageKeys) => (req, res, next) => {
  const pages = req.admin?.pages || DEFAULT_PAGES_BY_ROLE[req.admin?.role] || [];
  if (!pageKeys.some((key) => pages.includes(key))) {
    return res.status(403).json({ success: false, message: "Access denied. Missing page permission." });
  }
  next();
};
