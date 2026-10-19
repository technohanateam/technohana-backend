import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import CrmUser, { CRM_ROLES } from "../models/crmUser.model.js";
import { generateResetToken, verifyResetToken } from "../utils/resetTokenUtil.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { escapeHtml } from "../utils/emailTemplate.js";
import { isValidId } from "../utils/crmQuery.js";

const TOKEN_EXPIRY = "8h";
const BCRYPT_COST = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

const signCrmToken = (user) =>
  jwt.sign(
    { uid: user._id.toString(), email: user.email, name: user.name, crmRole: user.crmRole, tv: user.tokenVersion ?? 0 },
    process.env.CRM_JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY, algorithm: "HS256" }
  );

const sanitize = (user) => {
  const { passwordHash, resetTokenHash, resetTokenExpiry, tokenVersion, ...rest } = user.toObject ? user.toObject() : user;
  return rest;
};

const isLastActiveOwner = async (userId) => {
  const count = await CrmUser.countDocuments({ crmRole: "super_admin", active: true, _id: { $ne: userId } });
  return count === 0;
};

// Only an owner (super_admin) may create, edit, reset or remove another owner.
const isOwner = (req) => req.admin.crmRole === "super_admin";
const ownerOnly = (res) => res.status(403).json({ success: false, message: "Only an owner can manage owner accounts." });

// Comparing against a throwaway hash keeps "no such user" as slow as "wrong password".
let dummyHash;
const getDummyHash = async () => (dummyHash ||= await bcrypt.hash(crypto.randomBytes(16).toString("hex"), BCRYPT_COST));

const sameSecret = (a, b) => {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

// POST /api/crm/auth/login
export const crmLogin = async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    const user = await CrmUser.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      await bcrypt.compare(password, await getDummyHash());
      return res.status(401).json({ message: "Invalid credentials." });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ message: `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}, or reset your password.` });
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      user.failedLoginCount = (user.failedLoginCount || 0) + 1;
      if (user.failedLoginCount >= MAX_FAILED_LOGINS) {
        user.lockedUntil = new Date(Date.now() + LOCK_MS);
        user.failedLoginCount = 0;
      }
      await user.save();
      return res.status(401).json({ message: "Invalid credentials." });
    }
    if (!user.active) return res.status(401).json({ message: "Account deactivated." });

    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    return res.json({ token: signCrmToken(user), name: user.name, crmRole: user.crmRole });
  } catch (error) {
    console.error("CRM login error:", error);
    return res.status(500).json({ message: "Login failed." });
  }
};

// POST /api/crm/auth/setup — one-time bootstrap. Needs CRM_SETUP_TOKEN in the
// environment and the same value in the request, and only works while no
// CrmUser exists; unset the env var once the owner account is created.
export const setupCrmOwner = async (req, res) => {
  try {
    const expected = process.env.CRM_SETUP_TOKEN;
    if (!expected || !req.body?.setupToken || !sameSecret(req.body.setupToken, expected)) {
      return res.status(403).json({ success: false, message: "Setup is disabled." });
    }
    if ((await CrmUser.countDocuments()) > 0) {
      return res.status(403).json({ success: false, message: "Setup already complete." });
    }
    const { email, password, name = "CRM Owner" } = req.body;
    if (typeof email !== "string" || !email || String(password || "").length < 8) {
      return res.status(400).json({ success: false, message: "Email and a password of at least 8 characters are required." });
    }
    await CrmUser.create({
      email: email.toLowerCase().trim(),
      name: String(name),
      passwordHash: await bcrypt.hash(String(password), BCRYPT_COST),
      crmRole: "super_admin",
    });
    return res.status(201).json({ success: true, message: "CRM owner created. You can now log in." });
  } catch (error) {
    console.error("CRM setup error:", error);
    return res.status(500).json({ success: false, message: "Setup failed." });
  }
};

// Email-client-safe signature (table layout, inline styles, no images) used for CRM
// sends and offered on the profile page to paste into Gmail / Outlook / Zoho.
export const buildSignatureHtml = ({ name, title, phone, email, signature }) => {
  const line = (html, style = "") => `<tr><td style="padding:0 0 0 12px;font:13px/1.5 Arial,Helvetica,sans-serif;color:#475569;${style}">${html}</td></tr>`;
  const rows = [
    line(escapeHtml(name || "Technohana Sales"), "font-size:15px;font-weight:bold;color:#1e293b"),
    title && line(escapeHtml(title)),
    line("Technohana", "font-weight:bold;color:#7C3AED"),
    phone && line(`<a href="tel:${escapeHtml(phone.replace(/[^+\d]/g, ""))}" style="color:#475569;text-decoration:none">${escapeHtml(phone)}</a>`),
    email && line(`<a href="mailto:${escapeHtml(email)}" style="color:#475569;text-decoration:none">${escapeHtml(email)}</a>`),
    line(`<a href="https://www.technohana.in" style="color:#7C3AED;text-decoration:none">www.technohana.in</a>`),
    signature && line(escapeHtml(signature).replace(/\r?\n/g, "<br/>"), "padding-top:8px;font-size:12px;color:#64748b"),
  ].filter(Boolean).join("");
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid #8B5CF6;margin-top:24px"><tbody>${rows}</tbody></table>`;
};

// GET /api/crm/auth/me
export const crmMe = (req, res) => {
  const { _id, email, name, title, phone, signature, crmRole } = req.admin;
  res.json({ success: true, data: { _id, email, name, title, phone, signature, crmRole, signatureHtml: buildSignatureHtml(req.admin) } });
};

// PATCH /api/crm/auth/profile
export const updateCrmProfile = async (req, res) => {
  const { signature = "", title = "", phone = "" } = req.body;
  if ([signature, title, phone].some((v) => typeof v !== "string") || signature.length > 1000 || title.length > 100 || phone.length > 40) {
    return res.status(400).json({ success: false, message: "Check your title, phone and note — one is too long." });
  }
  try {
    const update = { signature: signature.trim(), title: title.trim(), phone: phone.trim() };
    await CrmUser.updateOne({ _id: req.admin._id }, update);
    res.json({ success: true, data: { ...update, signatureHtml: buildSignatureHtml({ ...req.admin, ...update }) } });
  } catch (error) {
    console.error("CRM profile update error:", error);
    res.status(500).json({ success: false, message: "Couldn't save your profile." });
  }
};

// POST /api/crm/auth/forgot-password
export const forgotCrmPassword = async (req, res) => {
  const { email } = req.body;
  if (typeof email !== "string" || !email) return res.status(400).json({ success: false, message: "Email required." });
  const generic = { success: true, message: "If that email is registered, a reset link has been sent." };
  try {
    const user = await CrmUser.findOne({ email: email.toLowerCase().trim() });
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
      html: `<p>Hi ${escapeHtml(user.name)},</p><p>Click the link below to reset your CRM password. This link is valid for 1 hour.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you did not request this, please ignore this email.</p>`,
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
  if (!isValidId(String(id)) || typeof token !== "string" || !token || typeof newPassword !== "string") {
    return res.status(400).json({ success: false, message: "id, token, and newPassword are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
  }
  try {
    const user = await CrmUser.findById(id);
    if (!user?.resetTokenHash || !user.resetTokenExpiry || user.resetTokenExpiry < new Date() || !verifyResetToken(token, user.resetTokenHash)) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset link." });
    }
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    user.resetTokenHash = null;
    user.resetTokenExpiry = null;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
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
    const users = await CrmUser.find().select("-passwordHash -resetTokenHash -resetTokenExpiry -tokenVersion").sort({ createdAt: -1 }).lean();
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
    if (typeof email !== "string" || typeof name !== "string" || typeof password !== "string" || !email || !name || !crmRole) {
      return res.status(400).json({ success: false, message: "Email, name, password and role are required." });
    }
    if (!CRM_ROLES.includes(crmRole)) {
      return res.status(400).json({ success: false, message: "Invalid CRM role." });
    }
    if (crmRole === "super_admin" && !isOwner(req)) return ownerOnly(res);
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (await CrmUser.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ success: false, message: "A user with this email already exists." });
    }
    const user = await CrmUser.create({
      email: normalizedEmail,
      name,
      crmRole,
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    });
    return res.status(201).json({ success: true, data: sanitize(user), message: "User created." });
  } catch (error) {
    console.error("Create CRM user error:", error);
    return res.status(500).json({ success: false, message: "Failed to create user." });
  }
};

const findTarget = async (req, res) => {
  const user = isValidId(req.params.id) && await CrmUser.findById(req.params.id);
  if (!user) {
    res.status(404).json({ success: false, message: "User not found." });
    return null;
  }
  if (user.crmRole === "super_admin" && !isOwner(req)) {
    ownerOnly(res);
    return null;
  }
  return user;
};

// PUT /api/crm/team/:id
export const updateCrmUser = async (req, res) => {
  try {
    const { name, crmRole } = req.body;
    const user = await findTarget(req, res);
    if (!user) return;

    if (crmRole !== undefined && crmRole !== user.crmRole) {
      if (!CRM_ROLES.includes(crmRole)) {
        return res.status(400).json({ success: false, message: "Invalid CRM role." });
      }
      if (req.admin.uid === String(user._id)) {
        return res.status(400).json({ success: false, message: "You can't change your own role." });
      }
      if (crmRole === "super_admin" && !isOwner(req)) return ownerOnly(res);
      if (user.crmRole === "super_admin" && user.active && (await isLastActiveOwner(user._id))) {
        return res.status(400).json({ success: false, message: "Cannot demote the last active owner." });
      }
      user.crmRole = crmRole;
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }
    if (typeof name === "string" && name.trim()) user.name = name.trim();

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
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }
    const user = await findTarget(req, res);
    if (!user) return;

    user.passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
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
    const { active } = req.body;
    if (typeof active !== "boolean") {
      return res.status(400).json({ success: false, message: "active must be a boolean." });
    }
    const user = await findTarget(req, res);
    if (!user) return;

    if (!active) {
      if (req.admin.uid === String(user._id)) {
        return res.status(400).json({ success: false, message: "You cannot deactivate your own account." });
      }
      if (user.crmRole === "super_admin" && user.active && (await isLastActiveOwner(user._id))) {
        return res.status(400).json({ success: false, message: "Cannot deactivate the last active owner." });
      }
      user.tokenVersion = (user.tokenVersion || 0) + 1;
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
    if (req.admin.uid === req.params.id) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account." });
    }
    const user = await findTarget(req, res);
    if (!user) return;

    if (user.crmRole === "super_admin" && user.active && (await isLastActiveOwner(user._id))) {
      return res.status(400).json({ success: false, message: "Cannot delete the last active owner." });
    }
    await CrmUser.deleteOne({ _id: user._id });
    return res.json({ success: true, message: "User deleted." });
  } catch (error) {
    console.error("Delete CRM user error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete user." });
  }
};
