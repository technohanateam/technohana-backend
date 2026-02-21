// this file contains the controller for user enrollment

import { User } from "../models/user.model.js";
import { generateEnrollmentConfirmationEmail, generateEnquiryTable } from "../utils/emailTemplate.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
export const enrollUser = async (req, res) => {
    try {
        const { name, email, phone, company, trainingPeriod, specialRequest, trainingLocation, courseTitle, userType, trainingType, price, currency } = req.body;
        const user = await User.create({
            name,
            email,
            phone,
            company,
            trainingPeriod,
            specialRequest,
            trainingLocation,
            courseTitle,
            userType,
            trainingType: trainingType || "individual",
            price: price || "N/A",
            currency: currency || "INR"
        })
        await user.save();

        // Send confirmation email to user
        try {
            await sendEmail({
                from: fromAddresses.sales,
                to: email,
                subject: "Enrollment Request Received - Technohana",
                html: generateEnrollmentConfirmationEmail({ name, courseTitle }),
            })
        } catch (mailErr) {
            console.error("Failed to send enrollment confirmation email:", mailErr);
        }

        // Send notification email to admin
        try {
            await sendEmail({
                from: fromAddresses.sales,
                to: process.env.MAIL_TO,
                subject: "New Course Enrollment: " + courseTitle,
                html: generateEnquiryTable({ name, email, phone, company, trainingPeriod, specialRequest, trainingLocation, courseTitle, userType, trainingType, price, currency }),
            })
        } catch (mailErr) {
            console.error("Failed to send admin notification email:", mailErr);
        }

        return res.status(201).json({
            success: true,
            message: "Enrollment form submitted successfully",
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        })
    }
}


export const getMyEnrollments = async (req, res) => {
    try {
        const { email } = req.user;
        const enrollments = await User.find({
            email,
            courseTitle: { $exists: true, $ne: null }
        }).sort({ _id: -1 }).lean();

        return res.status(200).json({ success: true, data: enrollments });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getUsersByStatus = async (req, res) => {
    try {
        // Get the status from the request query parameters
        const { status } = req.query;

        // Define the allowed statuses from your schema's enum
        const allowedStatuses = ["in-progress", "rejected", "enrolled"];

        // Check if the provided status is valid
        if (!status || !allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "A valid status is required. Please use 'in-progress', 'rejected', or 'enrolled'.",
            });
        }

        // Fetch users from the database with the matching status
        const users = await User.find({ status: status });

        return res.status(200).json({
            success: true,
            message: `Users with status '${status}' fetched successfully.`,
            data: users,
        });

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

// Update enrollment progress
export const updateEnrollmentProgress = async (req, res) => {
    try {
        const { enrollmentId } = req.params;
        const { progress, lessonsCompleted, totalLessons } = req.body;
        const { email } = req.user;

        const enrollment = await User.findOne({ _id: enrollmentId, email });
        if (!enrollment) {
            return res.status(404).json({ success: false, message: "Enrollment not found" });
        }

        if (progress !== undefined) enrollment.progress = Math.min(progress, 100);
        if (lessonsCompleted !== undefined) enrollment.lessonsCompleted = lessonsCompleted;
        if (totalLessons !== undefined) enrollment.totalLessons = totalLessons;

        enrollment.lastAccessedAt = new Date();

        // Auto-complete if progress is 100%
        if (enrollment.progress === 100 && enrollment.status !== 'completed') {
            enrollment.status = 'completed';
            enrollment.completedAt = new Date();
        }

        await enrollment.save();

        return res.status(200).json({
            success: true,
            message: "Progress updated successfully",
            data: enrollment
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// Issue certificate for completed course
export const issueCertificate = async (req, res) => {
    try {
        const { enrollmentId } = req.params;
        const { email } = req.user;

        const enrollment = await User.findOne({ _id: enrollmentId, email });
        if (!enrollment) {
            return res.status(404).json({ success: false, message: "Enrollment not found" });
        }

        if (enrollment.status !== 'completed' && enrollment.progress !== 100) {
            return res.status(400).json({
                success: false,
                message: "Course must be completed to issue certificate"
            });
        }

        if (enrollment.certificateIssued) {
            return res.status(400).json({
                success: false,
                message: "Certificate already issued"
            });
        }

        // Generate certificate number
        const certificateNumber = `TECH-${enrollment._id.toString().slice(-8).toUpperCase()}-${Date.now().toString().slice(-4)}`;

        enrollment.certificateIssued = true;
        enrollment.certificateNumber = certificateNumber;
        await enrollment.save();

        // Send certificate email
        try {
            const html = `
                <html>
                    <body style="font-family: Arial, sans-serif;">
                        <h2>Certificate of Completion</h2>
                        <p>Dear ${enrollment.name},</p>
                        <p>Congratulations! You have successfully completed the course:</p>
                        <h3>${enrollment.courseTitle}</h3>
                        <p>Your certificate number: <strong>${certificateNumber}</strong></p>
                        <p>Date: ${new Date().toLocaleDateString()}</p>
                        <p>Thank you for completing this training with Technohana.</p>
                    </body>
                </html>
            `;

            await sendEmail({
                from: fromAddresses.sales,
                to: email,
                subject: `Certificate of Completion - ${enrollment.courseTitle}`,
                html: html
            });
        } catch (mailErr) {
            console.error("Failed to send certificate email:", mailErr);
        }

        return res.status(200).json({
            success: true,
            message: "Certificate issued successfully",
            data: {
                certificateNumber,
                courseTitle: enrollment.courseTitle,
                userName: enrollment.name
            }
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
