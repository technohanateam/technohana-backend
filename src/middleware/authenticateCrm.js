import jwt from "jsonwebtoken";
import CrmUser from "../models/crmUser.model.js";

export const authenticateCrm = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Access denied, no token provided" });
  }

  try {
    const payload = jwt.verify(authHeader.split(" ")[1], process.env.CRM_JWT_SECRET, { algorithms: ["HS256"] });

    const account = await CrmUser.findById(payload.uid).select("active crmRole name email title phone signature tokenVersion leadPool poolLead").lean();
    if (!account || !account.active) {
      return res.status(401).json({ message: "Account deactivated" });
    }
    // Tokens issued before a password reset, deactivation or role change are void.
    if ((payload.tv ?? 0) !== (account.tokenVersion ?? 0)) {
      return res.status(401).json({ message: "Session expired, please sign in again" });
    }

    // req.admin keeps the shape the CRM controllers already read (_id, role, name, email)
    req.admin = {
      _id: account._id,
      uid: account._id.toString(),
      email: account.email,
      name: account.name,
      title: account.title || "",
      phone: account.phone || "",
      signature: account.signature || "",
      crmRole: account.crmRole,
      role: account.crmRole,
      leadPool: account.leadPool || "direct",
      poolLead: !!account.poolLead,
    };
    // A pool lead also sees the leads, deals and tasks assigned to the rest of their pool.
    if (req.admin.poolLead && account.crmRole === "sales") {
      const mates = await CrmUser.find({ active: true, crmRole: "sales", leadPool: account.leadPool, _id: { $ne: account._id } }).select("_id").lean();
      req.admin.teamIds = mates.map((u) => u._id);
    }
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired CRM token" });
  }
};
