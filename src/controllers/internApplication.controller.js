import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateInternshipAcknowledgementEmail } from "../utils/emailTemplate.js";
import InternApplication from "../models/internApplication.model.js";
import cloudinary from "../config/cloudinary.js";
import fs from "fs";

const safeUnlink = (filePath) => {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (fileError) {
    console.error("Failed to delete local file:", fileError);
  }
};

export const submitInternApplication = async (req, res) => {
  try {
    const {
      name, email, phone, department, college, degree, graduationYear,
      linkedinUrl, portfolioUrl, coverLetter, availability, duration,
    } = req.body;
    const file = req.file;

    if (!name || !email || !["sales", "marketing"].includes(department)) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and a valid department (sales or marketing) are required",
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "Resume is required",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const existing = await InternApplication.findOne({ email: normalizedEmail, department });
    if (existing) {
      safeUnlink(file.path);
      return res.status(409).json({
        success: false,
        message: "An application for this department with this email address has already been submitted.",
      });
    }

    let uploadResult;
    try {
      uploadResult = await cloudinary.uploader.upload(file.path, {
        folder: "technohana/intern-resumes",
        resource_type: "raw",
        access_mode: "public",
      });
    } catch (error) {
      console.log("Error in uploading resume", error);
      safeUnlink(file.path);
      return res.status(500).json({
        success: false,
        message: "Error in uploading resume",
      });
    }

    const internApplication = new InternApplication({
      name,
      email: normalizedEmail,
      phone,
      department,
      college,
      degree,
      graduationYear,
      linkedinUrl,
      portfolioUrl,
      coverLetter,
      availability,
      duration,
      resumeUrl: uploadResult.secure_url,
      resumePublicId: uploadResult.public_id,
    });

    await internApplication.save();

    try {
      await sendEmail({
        from: fromAddresses.careers,
        to: normalizedEmail,
        subject: "Your internship application has been received",
        html: generateInternshipAcknowledgementEmail({ name, department }),
      });
    } catch (emailError) {
      console.error("Failed to send applicant confirmation email:", emailError);
    }

    const rows = [
      ["Name", name],
      ["Email", `<a href="mailto:${normalizedEmail}" style="color:#27A8F5;text-decoration:none;">${normalizedEmail}</a>`],
      ["Phone", phone],
      ["Department", department === "marketing" ? "Marketing" : "Sales"],
      ["College", college],
      ["Degree", degree],
      ["Graduation Year", graduationYear],
      ["Availability", availability],
      ["Duration", duration],
      ["LinkedIn", linkedinUrl ? `<a href="${linkedinUrl}" style="color:#27A8F5;text-decoration:none;">${linkedinUrl}</a>` : null],
      ["Portfolio", portfolioUrl ? `<a href="${portfolioUrl}" style="color:#27A8F5;text-decoration:none;">${portfolioUrl}</a>` : null],
      ["Resume", `Attached · <a href="${uploadResult.secure_url}" style="color:#27A8F5;text-decoration:none;">Cloudinary link</a>`],
    ].filter(([, v]) => v);

    const rowsHtml = rows.map(([label, val], i) =>
      `<tr>
        <td style="padding:10px 12px;background:${i % 2 === 0 ? '#ffffff' : '#f0f7ff'};border-bottom:1px solid #e2e8f0;width:40%;font-size:13px;font-weight:600;color:#475569;">${label}</td>
        <td style="padding:10px 12px;background:${i % 2 === 0 ? '#ffffff' : '#f0f7ff'};border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${val}</td>
      </tr>`
    ).join('');

    const internalEmailContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#153C85;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#93c5fd;text-transform:uppercase;">Careers · Admin</p>
              <p style="margin:0;font-size:22px;font-weight:700;"><span style="color:#8B5CF6;">Techno</span><span style="color:#FFC107;">hana</span></p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">New Internship Application</h2>
              <p style="margin:0 0 20px;font-size:14px;color:#64748b;">A new ${department} internship application has been submitted.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:20px;">
                ${rowsHtml}
              </table>
              ${coverLetter ? `<div style="background:#f8fafc;border-left:4px solid #27A8F5;border-radius:0 8px 8px 0;padding:16px 20px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Cover Letter / Message</p>
                <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.7;">${coverLetter}</p>
              </div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">© ${new Date().getFullYear()} Technohana · <a href="https://technohana.in" style="color:#94a3b8;text-decoration:none;">technohana.in</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    try {
      const resumeAttachment = {
        filename: file.originalname,
        content: fs.readFileSync(file.path).toString('base64'),
        contentType: file.mimetype,
      };
      await sendEmail({
        from: fromAddresses.careers,
        to: process.env.MAIL_TO,
        subject: `New Internship Application (${department}): ${name}`,
        html: internalEmailContent,
        attachments: [resumeAttachment],
      });
    } catch (emailError) {
      console.error("Failed to send internal notification email:", emailError);
    }

    safeUnlink(file.path);

    return res.status(201).json({
      success: true,
      message: "Application received successfully",
      internApplicationId: internApplication._id,
    });
  } catch (error) {
    console.log("Error in submitting internship application", error);
    safeUnlink(req.file?.path);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
