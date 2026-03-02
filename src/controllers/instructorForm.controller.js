import { fromAddresses} from "../config/emailService.js"
import { generateResumeAcknowledgementEmail } from "../utils/emailTemplate.js";
import Instructor from "../models/instructor.js";
import cloudinary from "../config/cloudinary.js";
import fs from "fs";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async(to,subject,html,attachment = null)=>{
    try{
        const emailData = {
            from : fromAddresses.careers,
            to : to,
            subject : subject,
            html : html,
        };

        // Add attachment if provided
        if (attachment) {
            emailData.attachments = [attachment];
        }

        const data = await resend.emails.send(emailData);
        console.log(to,subject);
        return data;
    } catch(err){
        console.log(err);
        throw err;
    }
}

export const InstructorForm = async(req,res)=>{
    try {
        const {name,email,coverLetter} = req.body;
        const file = req.file;

        if(!name || !email || !file){
            return res.status(400).json({
                success : false,
                message : "All fields are required"
            })
        }
        let uploadResult;
        try {
            uploadResult = await cloudinary.uploader.upload(file.path,{
                folder : "technohana/instructor-resumes",
                resource_type : "raw"
            })
        } catch (error) {
            console.log("Error in uploading resume",error);
            return res.status(500).json({
                success : false,
                message : "Error in uploading resume",
                error : error.message
            })
        }

        const instructor = new Instructor({
            name,
            email,
            coverLetter,
            resumeUrl : uploadResult.secure_url,
            resumePublicId : uploadResult.public_id
        })

        await instructor.save();
        
        // Send confirmation email to applicant
        await sendEmail(email,"Your application has been received.",generateResumeAcknowledgementEmail({name}))
        console.log("confirmation email sent to ",email);

        // Send application with resume attachment to careers team
        const resumeAttachment = {
            filename: `${name}_resume.pdf`,
            content: fs.readFileSync(file.path).toString('base64'),
            contentType: 'application/pdf'
        };

        const careersEmailContent = `<!DOCTYPE html>
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
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Technohana</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">New Instructor Application</h2>
              <p style="margin:0 0 20px;font-size:14px;color:#64748b;">A new instructor application has been submitted. Resume is attached.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:20px;">
                <tr>
                  <td style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e2e8f0;width:40%;font-size:13px;font-weight:600;color:#475569;">Name</td>
                  <td style="padding:10px 12px;background:#ffffff;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${name}</td>
                </tr>
                <tr>
                  <td style="padding:10px 12px;background:#f0f7ff;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#475569;">Email</td>
                  <td style="padding:10px 12px;background:#f0f7ff;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;"><a href="mailto:${email}" style="color:#27A8F5;text-decoration:none;">${email}</a></td>
                </tr>
                <tr>
                  <td style="padding:10px 12px;background:#ffffff;font-size:13px;font-weight:600;color:#475569;">Resume</td>
                  <td style="padding:10px 12px;background:#ffffff;font-size:13px;color:#1e293b;">Attached to this email</td>
                </tr>
              </table>
              ${coverLetter ? `<div style="background:#f8fafc;border-left:4px solid #27A8F5;border-radius:0 8px 8px 0;padding:16px 20px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Cover Letter</p>
                <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.7;">${coverLetter}</p>
              </div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">© 2025 Technohana · <a href="https://technohana.in" style="color:#94a3b8;text-decoration:none;">technohana.in</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

        try {
            await sendEmail("careers@technohana.in", `New Instructor Application: ${name}`, careersEmailContent, resumeAttachment);
            console.log("application email sent to careers team");
        } catch (emailError) {
            console.error("Failed to send application email to careers team:", emailError);
            // Continue with the process even if email fails
        }

        // Delete the local file after sending emails
        try {
            fs.unlinkSync(file.path);
        } catch (fileError) {
            console.error("Failed to delete local file:", fileError);
        }

        return res.status(200).json({
            success : true,
            message : "Application received successfully",
            instructorId : instructor._id
        })
        
    } catch (error) {
        console.log("Error in uploading Instructor Form",error);
        return res.status(500).json({
            success : false,
            message : "Error in uploading resume",
            error : error.message
        })
    }
}