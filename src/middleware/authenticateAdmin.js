import jwt from "jsonwebtoken";
import AdminUser from "../models/adminUser.model.js";
import { DEFAULT_PAGES_BY_ROLE } from "../constants/adminPages.js";

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

    req.admin = payload;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired admin token" });
  }
};

// Requires full admin role — blocks sales and marketing roles from destructive operations
export const requireAdmin = (req, res, next) => {
  if (req.admin?.role !== "admin") {
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
