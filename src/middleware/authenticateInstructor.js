import jwt from "jsonwebtoken";
import Instructor from "../models/instructor.js";

const ACTIVITY_WRITE_INTERVAL_MS = 10 * 60 * 1000;

export const authenticateInstructor = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Access denied, no token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.role !== "instructor") {
      return res.status(403).json({ success: false, message: "Instructor role required" });
    }

    const instructor = await Instructor.findById(payload.id).select("isActive complianceStatus lastActiveAt").lean();
    if (!instructor || !instructor.isActive) {
      return res.status(401).json({ success: false, message: "Account is not active" });
    }

    if (!instructor.lastActiveAt || Date.now() - instructor.lastActiveAt.getTime() > ACTIVITY_WRITE_INTERVAL_MS) {
      Instructor.updateOne({ _id: payload.id }, { lastActiveAt: new Date() }).catch(() => {});
    }

    req.instructor = { ...payload, isActive: instructor.isActive, complianceStatus: instructor.complianceStatus };
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};
