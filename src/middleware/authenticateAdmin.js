import jwt from "jsonwebtoken";

export const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Access denied, no token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
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
