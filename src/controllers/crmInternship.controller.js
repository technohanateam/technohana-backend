import InternApplication from "../models/internApplication.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import cloudinary from "../config/cloudinary.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STATUSES = ["applied", "shortlisted", "interviewing", "offered", "hired", "rejected"];
const DEPARTMENTS = ["sales", "marketing", "engineering", "design"];

export const getInternApplications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;

    const { department, status, search } = req.query;
    const filter = {};
    if (department && DEPARTMENTS.includes(department)) filter.department = department;
    if (status && STATUSES.includes(status)) filter.status = status;
    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: re }, { email: re }];
    }

    const [data, total] = await Promise.all([
      InternApplication.find(filter).sort({ submittedAt: -1 }).skip(skip).limit(limit).lean(),
      InternApplication.countDocuments(filter),
    ]);

    res.json({ success: true, data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch internship applications" });
  }
};

export const getInternApplication = async (req, res) => {
  try {
    const application = await InternApplication.findById(req.params.id).lean();
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    res.json({ success: true, data: application });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch application" });
  }
};

export const updateInternApplication = async (req, res) => {
  try {
    const { notes, assignedTo, nextFollowUp } = req.body;
    const update = {};
    if (notes !== undefined) update.notes = notes;
    if (assignedTo !== undefined) update.assignedTo = assignedTo;
    if (nextFollowUp !== undefined) update.nextFollowUp = nextFollowUp || null;

    const updated = await InternApplication.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Application not found" });
    res.json({ success: true, data: updated, message: "Application updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update application" });
  }
};

export const updateInternApplicationStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const updated = await InternApplication.findByIdAndUpdate(
      req.params.id,
      {
        status,
        statusChangedBy: req.admin?.name || req.admin?.email || "",
        statusChangedAt: new Date(),
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: "Application not found" });
    res.json({ success: true, data: updated, message: "Status updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update status" });
  }
};

export const deleteInternApplication = async (req, res) => {
  try {
    const application = await InternApplication.findById(req.params.id);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    if (application.resumePublicId) {
      await cloudinary.uploader.destroy(application.resumePublicId, { resource_type: "raw" }).catch(() => {});
    }
    await application.deleteOne();
    res.json({ success: true, message: "Application deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete application" });
  }
};

const emailTemplates = (name, customMessage) => ({
  shortlisted: {
    subject: "Your Technohana Internship Application — Next Steps",
    html: `<p>Hi ${name},</p><p>Great news! We've reviewed your application and would love to schedule a brief interview. Please reply to this email with your availability.</p>${customMessage ? `<p>${customMessage}</p>` : ""}<p>Best regards,<br/>Technohana Careers Team</p>`,
  },
  interviewing: {
    subject: "Your Technohana Internship Interview",
    html: `<p>Hi ${name},</p><p>Thanks for your time so far! We'd like to move forward with an interview — our team will be in touch shortly to confirm a time.</p>${customMessage ? `<p>${customMessage}</p>` : ""}<p>Best regards,<br/>Technohana Careers Team</p>`,
  },
  offered: {
    subject: "Your Technohana Internship Offer",
    html: `<p>Hi ${name},</p><p>Congratulations! We're excited to offer you the internship position. Our team will reach out with the offer details shortly.</p>${customMessage ? `<p>${customMessage}</p>` : ""}<p>Best regards,<br/>Technohana Careers Team</p>`,
  },
  rejected: {
    subject: "Your Technohana Internship Application",
    html: `<p>Hi ${name},</p><p>Thank you for applying for an internship with Technohana. After careful review, we won't be moving forward at this time. We'll keep your profile on file for future opportunities.</p>${customMessage ? `<p>${customMessage}</p>` : ""}<p>Best regards,<br/>Technohana Careers Team</p>`,
  },
  hired: {
    subject: "Welcome to Technohana!",
    html: `<p>Hi ${name},</p><p>We're thrilled to have you join Technohana as an intern! Our team will reach out shortly with your onboarding details.</p>${customMessage ? `<p>${customMessage}</p>` : ""}<p>Best regards,<br/>Technohana Careers Team</p>`,
  },
  custom: {
    subject: "Message from Technohana",
    html: `<p>Hi ${name},</p><p>${customMessage || ""}</p><p>Best regards,<br/>Technohana Careers Team</p>`,
  },
});

export const emailInternApplicant = async (req, res) => {
  try {
    const application = await InternApplication.findById(req.params.id).lean();
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    const { template, customMessage } = req.body;
    const templates = emailTemplates(application.name || "there", customMessage);
    const tpl = templates[template];
    if (!tpl) return res.status(400).json({ success: false, message: "Invalid template" });

    const statusMap = {
      shortlisted: "shortlisted",
      interviewing: "interviewing",
      offered: "offered",
      rejected: "rejected",
      hired: "hired",
    };
    if (statusMap[template]) {
      await InternApplication.findByIdAndUpdate(req.params.id, {
        status: statusMap[template],
        statusChangedBy: req.admin?.name || req.admin?.email || "",
        statusChangedAt: new Date(),
      });
    }

    await sendEmail({ from: fromAddresses.careers, to: application.email, subject: tpl.subject, html: tpl.html });
    res.json({ success: true, message: "Email sent" });
  } catch (err) {
    console.error("Intern applicant email error:", err);
    res.status(500).json({ success: false, message: "Failed to send email" });
  }
};

// GET /api/crm/internships/resume-proxy?url=<cloudinary_url>&disposition=inline|attachment
export const getInternResumeProxy = async (req, res) => {
  const { url, disposition = "attachment" } = req.query;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!url || !url.startsWith(`https://res.cloudinary.com/${cloudName}/`)) {
    return res.status(400).json({ success: false, message: "Invalid URL" });
  }
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(\?|$)/);
    if (!match) return res.status(400).json({ success: false, message: "Could not parse public_id" });
    const publicId = match[1];

    const signedUrl = cloudinary.utils.private_download_url(publicId, null, {
      resource_type: "raw",
      type: "upload",
      attachment: disposition === "attachment",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });

    return res.redirect(302, signedUrl);
  } catch (err) {
    console.error("Intern resume proxy error:", err);
    res.status(502).json({ success: false, message: "Failed to generate signed URL" });
  }
};
