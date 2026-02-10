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

        const careersEmailContent = `
            <div style="font-family:sans-serif;line-height:1.6;">
                <h2 style="color:#1769ff;">New Instructor Application Received!</h2>
                <p><strong>Name:</strong> ${name}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Cover Letter:</strong> ${coverLetter || 'Not provided'}</p>
                <p>Resume is attached to this email.</p>
                <p style="margin-top:2em;color:#888;">Best regards,<br/>Technohana Team</p>
            </div>
        `;

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