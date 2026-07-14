import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import AdminUser from "../models/adminUser.model.js";
import { generateResetToken, verifyResetToken } from "../utils/resetTokenUtil.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import {
  ADMIN_PAGES,
  ADMIN_ROLES,
  DEFAULT_PAGES_BY_ROLE,
  computeEffectivePages,
} from "../constants/adminPages.js";

const TOKEN_EXPIRY = "8h";

const signAdminToken = (payload) =>
  jwt.sign(payload, process.env.ADMIN_JWT_SECRET, { expiresIn: TOKEN_EXPIRY });

const matchEnvRole = async (email, password) => {
  const normalizedEmail = String(email).toLowerCase().trim();

  if (normalizedEmail === process.env.ADMIN_EMAIL?.toLowerCase() && process.env.ADMIN_PASSWORD_HASH && await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH)) {
    return "admin";
  }
  if (process.env.SALES_EMAIL && normalizedEmail === process.env.SALES_EMAIL.toLowerCase() && process.env.SALES_PASSWORD_HASH && await bcrypt.compare(password, process.env.SALES_PASSWORD_HASH)) {
    return "sales";
  }
  if (process.env.MARKETING_EMAIL && normalizedEmail === process.env.MARKETING_EMAIL.toLowerCase() && process.env.MARKETING_PASSWORD_HASH && await bcrypt.compare(password, process.env.MARKETING_PASSWORD_HASH)) {
    return "marketing";
  }
  return null;
};

const invalidPageKeys = (pages = []) => pages.filter((page) => !ADMIN_PAGES.includes(page));

const sanitize = (user) => {
  const { passwordHash, ...rest } = user.toObject ? user.toObject() : user;
  return {
    ...rest,
    effectivePages: computeEffectivePages(rest.role, rest.extraPages, rest.revokedPages),
  };
};

// POST /admin/login — DB-backed accounts first, env-var credentials as bootstrap fallback
export const adminLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  try {
    const dbUser = await AdminUser.findOne({ email: normalizedEmail });

    if (dbUser) {
      if (!dbUser.active) {
        return res.status(401).json({ message: "Account deactivated." });
      }
      const valid = await bcrypt.compare(password, dbUser.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid credentials." });
      }

      dbUser.lastLoginAt = new Date();
      await dbUser.save();

      const token = signAdminToken({
        uid: dbUser._id.toString(),
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
        pages: computeEffectivePages(dbUser.role, dbUser.extraPages, dbUser.revokedPages),
        src: "db",
      });
      return res.json({ token, name: dbUser.name, role: dbUser.role });
    }

    const envRole = await matchEnvRole(email, password);
    if (!envRole) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const token = signAdminToken({
      email,
      role: envRole,
      pages: DEFAULT_PAGES_BY_ROLE[envRole],
      src: "env",
    });
    return res.json({ token, role: envRole });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({ message: "Login failed." });
  }
};

// POST /admin/setup — one-time bootstrap; disabled once any AdminUser exists
export const setupAdmin = async (req, res) => {
  try {
    const count = await AdminUser.countDocuments();
    if (count > 0) {
      return res.status(403).json({ success: false, message: "Setup already complete. Use /admin/login." });
    }
    const { email, password, name = "Admin" } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }
    const normalizedEmail = String(email).toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 10);
    await AdminUser.create({ email: normalizedEmail, name, passwordHash, role: "admin" });
    return res.status(201).json({ success: true, message: "Admin account created. You can now log in." });
  } catch (error) {
    console.error("Admin setup error:", error);
    return res.status(500).json({ success: false, message: "Setup failed." });
  }
};

// GET /admin/users
export const listAdminUsers = async (req, res) => {
  try {
    const users = await AdminUser.find().select("-passwordHash").sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: users.map(sanitize) });
  } catch (error) {
    console.error("List admin users error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch users." });
  }
};

// POST /admin/users
export const createAdminUser = async (req, res) => {
  try {
    const { email, name, password, role, extraPages = [], revokedPages = [] } = req.body;

    if (!email || !name || !password || !role) {
      return res.status(400).json({ success: false, message: "Email, name, password and role are required." });
    }
    if (!ADMIN_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }
    const badKeys = invalidPageKeys([...extraPages, ...revokedPages]);
    if (badKeys.length) {
      return res.status(400).json({ success: false, message: `Unknown page keys: ${badKeys.join(", ")}` });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await AdminUser.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ success: false, message: "A user with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await AdminUser.create({
      email: normalizedEmail,
      name,
      passwordHash,
      role,
      extraPages,
      revokedPages,
    });

    return res.status(201).json({ success: true, data: sanitize(user), message: "User created." });
  } catch (error) {
    console.error("Create admin user error:", error);
    return res.status(500).json({ success: false, message: "Failed to create user." });
  }
};

const isLastActiveAdmin = async (userId) => {
  const count = await AdminUser.countDocuments({ role: "admin", active: true, _id: { $ne: userId } });
  return count === 0;
};

// PUT /admin/users/:id
export const updateAdminUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, extraPages, revokedPages } = req.body;

    const user = await AdminUser.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (role !== undefined) {
      if (!ADMIN_ROLES.includes(role)) {
        return res.status(400).json({ success: false, message: "Invalid role." });
      }
      if (role !== "admin" && user.role === "admin" && user.active && (await isLastActiveAdmin(id))) {
        return res.status(400).json({ success: false, message: "Cannot demote the last active admin." });
      }
      user.role = role;
    }
    if (name !== undefined) user.name = name;
    if (extraPages !== undefined || revokedPages !== undefined) {
      const badKeys = invalidPageKeys([...(extraPages || []), ...(revokedPages || [])]);
      if (badKeys.length) {
        return res.status(400).json({ success: false, message: `Unknown page keys: ${badKeys.join(", ")}` });
      }
      if (extraPages !== undefined) user.extraPages = extraPages;
      if (revokedPages !== undefined) user.revokedPages = revokedPages;
    }

    await user.save();
    return res.json({ success: true, data: sanitize(user), message: "User updated." });
  } catch (error) {
    console.error("Update admin user error:", error);
    return res.status(500).json({ success: false, message: "Failed to update user." });
  }
};

// PATCH /admin/users/:id/password
export const resetAdminUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || String(password).length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const user = await AdminUser.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    return res.json({ success: true, message: "Password updated." });
  } catch (error) {
    console.error("Reset admin user password error:", error);
    return res.status(500).json({ success: false, message: "Failed to update password." });
  }
};

// PATCH /admin/users/:id/active
export const setAdminUserActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    if (typeof active !== "boolean") {
      return res.status(400).json({ success: false, message: "active must be a boolean." });
    }

    const user = await AdminUser.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (!active) {
      if (req.admin?.uid === id) {
        return res.status(400).json({ success: false, message: "You cannot deactivate your own account." });
      }
      if (user.role === "admin" && user.active && (await isLastActiveAdmin(id))) {
        return res.status(400).json({ success: false, message: "Cannot deactivate the last active admin." });
      }
    }

    user.active = active;
    await user.save();
    return res.json({ success: true, data: sanitize(user), message: active ? "User reactivated." : "User deactivated." });
  } catch (error) {
    console.error("Set admin user active error:", error);
    return res.status(500).json({ success: false, message: "Failed to update user status." });
  }
};

// POST /admin/forgot-password — send a reset link to the admin's registered email
export const forgotAdminPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email required." });
  try {
    const user = await AdminUser.findOne({ email: String(email).toLowerCase().trim() });
    // Always return 200 to prevent email enumeration
    if (!user || !user.active) {
      return res.json({ success: true, message: "If that email is registered, a reset link has been sent." });
    }
    const { token, hash } = generateResetToken();
    user.resetTokenHash = hash;
    user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();
    const resetLink = `${process.env.FRONTEND_URL}/admin/reset-password?token=${token}&id=${user._id}`;
    await sendEmail({
      from: fromAddresses.noreply,
      to: user.email,
      subject: "Technohana Admin — Password Reset",
      html: `<p>Hi ${user.name},</p><p>Click the link below to reset your admin password. This link is valid for 1 hour.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you did not request this, please ignore this email.</p>`,
    });
    return res.json({ success: true, message: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    console.error("Admin forgot-password error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /admin/reset-password — verify the token and set a new password
export const resetAdminPasswordViaToken = async (req, res) => {
  const { id, token, newPassword } = req.body;
  if (!id || !token || !newPassword) {
    return res.status(400).json({ success: false, message: "id, token, and newPassword are required." });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
  }
  try {
    const user = await AdminUser.findById(id);
    if (!user || !user.resetTokenHash || !user.resetTokenExpiry) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset link." });
    }
    if (user.resetTokenExpiry < new Date()) {
      return res.status(400).json({ success: false, message: "Reset link has expired." });
    }
    if (!verifyResetToken(token, user.resetTokenHash)) {
      return res.status(400).json({ success: false, message: "Invalid reset token." });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.resetTokenHash = null;
    user.resetTokenExpiry = null;
    await user.save();
    return res.json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (err) {
    console.error("Admin reset-password error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
