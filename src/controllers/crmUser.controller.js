import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import CrmUser, { CRM_ROLES } from "../models/crmUser.model.js";
import { generateResetToken, verifyResetToken } from "../utils/resetTokenUtil.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";

const TOKEN_EXPIRY = "8h";

const signCrmToken = (user) =>
  jwt.sign(
    { uid: user._id.toString(), email: user.email, name: user.name, crmRole: user.crmRole },
    process.env.CRM_JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

const sanitize = (user) => {
  const { passwordHash, resetTokenHash, resetTokenExpiry, ...rest } = user.toObject ? user.toObject() : user;
  return rest;
};

const isLastActiveOwner = async (userId) => {
  const count = await CrmUser.countDocuments({ crmRole: "super_admin", active: true, _id: { $ne: userId } });
  return count === 0;
};

// POST /api/crm/auth/login
export const crmLogin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const user = await CrmUser.findOne({ email: String(email).toLowerCase().trim() });
    const valid = user && (await bcrypt.compare(password, user.passwordHash));
    if (!valid) return res.status(401).json({ message: "Invalid credentials." });
    if (!user.active) return res.status(401).json({ message: "Account deactivated." });

    user.lastLoginAt = new Date();
    await user.save();

    return res.json({ token: signCrmToken(user), name: user.name, crmRole: user.crmRole });
  } catch (error) {
    console.error("CRM login error:", error);
    return res.status(500).json({ message: "Login failed." });
  }
};

// POST /api/crm/auth/setup — one-time bootstrap; disabled once any CrmUser exists
export const setupCrmOwner = async (req, res) => {
  try {
    if ((await CrmUser.countDocuments()) > 0) {
      return res.status(403).json({ success: false, message: "Setup already complete." });
    }
    const { email, password, name = "CRM Owner" } = req.body;
    if (!email || !password || String(password).length < 8) {
      return res.status(400).json({ success: false, message: "Email and a password of at least 8 characters are required." });
    }
    await CrmUser.create({
      email: String(email).toLowerCase().trim(),
      name,
      passwordHash: await bcrypt.hash(password, 10),
      crmRole: "super_admin",
    });
    return res.status(201).json({ success: true, message: "CRM owner created. You can now log in." });
  } catch (error) {
    console.error("CRM setup error:", error);
    return res.status(500).json({ success: false, message: "Setup failed." });
  }
};

// GET /api/crm/auth/me
export const crmMe = (req, res) =>
  res.json({ success: true, data: { _id: req.admin._id, email: req.admin.email, name: req.admin.name, crmRole: req.admin.crmRole } });

// POST /api/crm/auth/forgot-password
export const forgotCrmPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email required." });
  const generic = { success: true, message: "If that email is registered, a reset link has been sent." };
  try {
    const user = await CrmUser.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !user.active) return res.json(generic);

    const { token, hash } = generateResetToken();
    user.resetTokenHash = hash;
    user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const resetLink = `${process.env.CRM_FRONTEND_URL}/reset-password?token=${token}&id=${user._id}`;
    await sendEmail({
      from: fromAddresses.sales,
      to: user.email,
      subject: "Technohana CRM — Password Reset",
      html: `<p>Hi ${user.name},</p><p>Click the link below to reset your CRM password. This link is valid for 1 hour.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you did not request this, please ignore this email.</p>`,
    });
    return res.json(generic);
  } catch (error) {
    console.error("CRM forgot-password error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /api/crm/auth/reset-password
export const resetCrmPasswordViaToken = async (req, res) => {
  const { id, token, newPassword } = req.body;
  if (!id || !token || !newPassword) {
    return res.status(400).json({ success: false, message: "id, token, and newPassword are required." });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
  }
  try {
    const user = await CrmUser.findById(id);
    if (!user?.resetTokenHash || !user.resetTokenExpiry || user.resetTokenExpiry < new Date() || !verifyResetToken(token, user.resetTokenHash)) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset link." });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.resetTokenHash = null;
    user.resetTokenExpiry = null;
    await user.save();
    return res.json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error("CRM reset-password error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// GET /api/crm/team
export const listCrmUsers = async (req, res) => {
  try {
    const users = await CrmUser.find().select("-passwordHash -resetTokenHash -resetTokenExpiry").sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: users });
  } catch (error) {
    console.error("List CRM users error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch users." });
  }
};

// GET /api/crm/team/options — id + name of active users, for assignee dropdowns
export const listCrmUserOptions = async (req, res) => {
  try {
    const users = await CrmUser.find({ active: true }).select("name email crmRole").sort({ name: 1 }).lean();
    return res.json({ success: true, data: users });
  } catch (error) {
    console.error("List CRM user options error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch users." });
  }
};

// POST /api/crm/team
export const createCrmUser = async (req, res) => {
  try {
    const { email, name, password, crmRole } = req.body;
    if (!email || !name || !password || !crmRole) {
      return res.status(400).json({ success: false, message: "Email, name, password and role are required." });
    }
    if (!CRM_ROLES.includes(crmRole)) {
      return res.status(400).json({ success: false, message: "Invalid CRM role." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }
    const normalizedEmail = String(email).toLowerCase().trim();
    if (await CrmUser.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ success: false, message: "A user with this email already exists." });
    }
    const user = await CrmUser.create({
      email: normalizedEmail,
      name,
      crmRole,
      passwordHash: await bcrypt.hash(password, 10),
    });
    return res.status(201).json({ success: true, data: sanitize(user), message: "User created." });
  } catch (error) {
    console.error("Create CRM user error:", error);
    return res.status(500).json({ success: false, message: "Failed to create user." });
  }
};

// PUT /api/crm/team/:id
export const updateCrmUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, crmRole } = req.body;
    const user = await CrmUser.findById(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    if (crmRole !== undefined) {
      if (!CRM_ROLES.includes(crmRole)) {
        return res.status(400).json({ success: false, message: "Invalid CRM role." });
      }
      if (crmRole !== "super_admin" && user.crmRole === "super_admin" && user.active && (await isLastActiveOwner(id))) {
        return res.status(400).json({ success: false, message: "Cannot demote the last active owner." });
      }
      user.crmRole = crmRole;
    }
    if (name !== undefined) user.name = name;

    await user.save();
    return res.json({ success: true, data: sanitize(user), message: "User updated." });
  } catch (error) {
    console.error("Update CRM user error:", error);
    return res.status(500).json({ success: false, message: "Failed to update user." });
  }
};

// PATCH /api/crm/team/:id/password
export const resetCrmUserPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || String(password).length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }
    const user = await CrmUser.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    return res.json({ success: true, message: "Password updated." });
  } catch (error) {
    console.error("Reset CRM user password error:", error);
    return res.status(500).json({ success: false, message: "Failed to update password." });
  }
};

// PATCH /api/crm/team/:id/active
export const setCrmUserActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;
    if (typeof active !== "boolean") {
      return res.status(400).json({ success: false, message: "active must be a boolean." });
    }
    const user = await CrmUser.findById(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    if (!active) {
      if (req.admin.uid === id) {
        return res.status(400).json({ success: false, message: "You cannot deactivate your own account." });
      }
      if (user.crmRole === "super_admin" && user.active && (await isLastActiveOwner(id))) {
        return res.status(400).json({ success: false, message: "Cannot deactivate the last active owner." });
      }
    }
    user.active = active;
    await user.save();
    return res.json({ success: true, data: sanitize(user), message: active ? "User reactivated." : "User deactivated." });
  } catch (error) {
    console.error("Set CRM user active error:", error);
    return res.status(500).json({ success: false, message: "Failed to update user status." });
  }
};

// DELETE /api/crm/team/:id
export const deleteCrmUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.admin.uid === id) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account." });
    }
    const user = await CrmUser.findById(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    if (user.crmRole === "super_admin" && user.active && (await isLastActiveOwner(id))) {
      return res.status(400).json({ success: false, message: "Cannot delete the last active owner." });
    }
    await CrmUser.deleteOne({ _id: id });
    return res.json({ success: true, message: "User deleted." });
  } catch (error) {
    console.error("Delete CRM user error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete user." });
  }
};
