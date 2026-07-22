import fs from "fs";
import cloudinary from "../config/cloudinary.js";
import TrainingRequirement from "../models/trainingRequirement.model.js";
import CareerApplication from "../models/careerApplication.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateCareerApplicationAcknowledgementEmail, generateCareerApplicationAdminEmail } from "../utils/emailTemplate.js";

const safeUnlink = (filePath) => {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (fileError) {
    console.error("Failed to delete local file:", fileError);
  }
};

const PUBLIC_FIELDS = "title description topic expertise deliveryMode duration participants budgetRange location startDate deadline createdAt";

export const listOpenTrainingRequirements = async (req, res) => {
  try {
    const openings = await TrainingRequirement.find({ status: "open" })
      .select(PUBLIC_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: openings });
  } catch (err) {
    console.error("List career openings error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch openings" });
  }
};

export const applyToTrainingRequirement = async (req, res) => {
  try {
    const { name, email, phone, expertise, coverLetter } = req.body;
    const file = req.file;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: "Name and email are required" });
    }
    if (!file) {
      return res.status(400).json({ success: false, message: "Resume is required" });
    }

    const requirement = await TrainingRequirement.findOne({ _id: req.params.id, status: "open" });
    if (!requirement) {
      safeUnlink(file.path);
      return res.status(404).json({ success: false, message: "This opening is no longer available" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    let uploadResult;
    try {
      uploadResult = await cloudinary.uploader.upload(file.path, {
        folder: "technohana/career-resumes",
        resource_type: "raw",
        access_mode: "public",
      });
    } catch (error) {
      console.error("Error uploading resume:", error);
      safeUnlink(file.path);
      return res.status(500).json({ success: false, message: "Error uploading resume" });
    }

    const application = await CareerApplication.create({
      requirementId: requirement._id,
      name,
      email: normalizedEmail,
      phone,
      expertise,
      coverLetter,
      resumeUrl: uploadResult.secure_url,
      resumePublicId: uploadResult.public_id,
    });

    try {
      await sendEmail({
        from: fromAddresses.careers,
        to: normalizedEmail,
        subject: "Your application has been received",
        html: generateCareerApplicationAcknowledgementEmail({ name, requirementTitle: requirement.title }),
      });
    } catch (emailError) {
      console.error("Failed to send applicant confirmation email:", emailError);
    }

    try {
      const resumeAttachment = {
        filename: file.originalname,
        content: fs.readFileSync(file.path).toString("base64"),
        contentType: file.mimetype,
      };
      await sendEmail({
        from: fromAddresses.careers,
        to: process.env.MAIL_TO,
        subject: `New Career Application: ${name} — ${requirement.title}`,
        html: generateCareerApplicationAdminEmail({
          name, email: normalizedEmail, phone, expertise, coverLetter,
          requirementTitle: requirement.title, resumeUrl: uploadResult.secure_url,
        }),
        attachments: [resumeAttachment],
      });
    } catch (emailError) {
      console.error("Failed to send internal notification email:", emailError);
    }

    safeUnlink(file.path);

    return res.status(201).json({ success: true, message: "Application received successfully", applicationId: application._id });
  } catch (err) {
    console.error("Career application error:", err);
    safeUnlink(req.file?.path);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
