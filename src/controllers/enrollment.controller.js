// this file contains the controller for user enrollment

import { User } from "../models/user.model.js";
import Course from "../models/course.model.js";
import InstructorReview, { recomputeInstructorRating } from "../models/instructorReview.model.js";
import { generateEnrollmentConfirmationEmail, generateEnquiryTable } from "../utils/emailTemplate.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { validateEnrollmentForm, sanitizeString } from "../utils/inputValidator.js";

export const enrollUser = async (req, res) => {
    try {
        const { name, email, phone, company, trainingPeriod, specialRequest, trainingLocation, courseTitle, userType, trainingType, price, currency, batchDate, batchTime } = req.body;

        const validation = validateEnrollmentForm({ name, email, phone, company, courseTitle, specialRequest, trainingLocation, price, currency, trainingType });
        if (!validation.isValid) {
            return res.status(400).json({ success: false, message: 'Invalid input', errors: validation.errors });
        }
        const user = await User.create({
            name: sanitizeString(name),
            email: email.trim().toLowerCase(),
            phone: sanitizeString(phone),
            company: company ? sanitizeString(company) : undefined,
            trainingPeriod: trainingPeriod ? sanitizeString(trainingPeriod) : undefined,
            specialRequest: specialRequest ? sanitizeString(specialRequest) : undefined,
            trainingLocation: trainingLocation ? sanitizeString(trainingLocation) : undefined,
            courseTitle: sanitizeString(courseTitle),
            userType: userType ? sanitizeString(userType) : undefined,
            trainingType: trainingType || "individual",
            price: price || "N/A",
            currency: (currency || "INR").toUpperCase(),
            batchDate: batchDate || null,
            batchTime: batchTime || null,
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

// Update enrollment details (only for in-progress enrollments)
export const updateEnrollment = async (req, res) => {
    try {
        const { enrollmentId } = req.params;
        const { email } = req.user;
        const { trainingPeriod, trainingLocation, specialRequest } = req.body;

        const enrollment = await User.findOne({ _id: enrollmentId, email });
        if (!enrollment) {
            return res.status(404).json({ success: false, message: "Enrollment not found" });
        }

        if (enrollment.status !== 'in-progress') {
            return res.status(400).json({ success: false, message: "Only pending enrollments can be updated" });
        }

        if (trainingPeriod !== undefined) enrollment.trainingPeriod = trainingPeriod;
        if (trainingLocation !== undefined) enrollment.trainingLocation = trainingLocation;
        if (specialRequest !== undefined) enrollment.specialRequest = specialRequest;

        await enrollment.save();

        return res.status(200).json({ success: true, message: "Enrollment updated successfully", data: enrollment });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// Delete enrollment (only for in-progress enrollments)
export const deleteEnrollment = async (req, res) => {
    try {
        const { enrollmentId } = req.params;
        const { email } = req.user;

        const enrollment = await User.findOne({ _id: enrollmentId, email });
        if (!enrollment) {
            return res.status(404).json({ success: false, message: "Enrollment not found" });
        }

        if (enrollment.status !== 'in-progress') {
            return res.status(400).json({ success: false, message: "Only pending enrollments can be cancelled" });
        }

        enrollment.courseTitle = null;
        enrollment.status = undefined;
        enrollment.trainingPeriod = undefined;
        enrollment.trainingLocation = undefined;
        enrollment.trainingType = undefined;
        enrollment.specialRequest = undefined;
        enrollment.price = undefined;
        enrollment.currency = undefined;

        await User.deleteOne({ _id: enrollmentId, email });

        return res.status(200).json({ success: true, message: "Enrollment cancelled successfully" });
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
            return res.status(200).json({
                success: true,
                message: "Certificate already issued",
                data: {
                    certificateNumber: enrollment.certificateNumber,
                    courseTitle: enrollment.courseTitle,
                    userName: enrollment.name
                }
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

// Submit or update a rating/review for the instructor of a completed enrollment
export const submitInstructorReview = async (req, res) => {
    try {
        const { enrollmentId } = req.params;
        const { email } = req.user;
        const { rating, reviewText } = req.body;

        const ratingNum = Number(rating);
        if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({ success: false, message: "Rating must be an integer between 1 and 5" });
        }

        const enrollment = await User.findOne({ _id: enrollmentId, email });
        if (!enrollment) {
            return res.status(404).json({ success: false, message: "Enrollment not found" });
        }
        if (enrollment.status !== "completed") {
            return res.status(400).json({ success: false, message: "You can only review a course after completing it" });
        }

        const course = await Course.findOne({ courseTitle: enrollment.courseTitle, instructorId: { $exists: true, $ne: null } });
        if (!course) {
            return res.status(400).json({ success: false, message: "This course doesn't have an assigned instructor to review" });
        }

        const existing = await InstructorReview.findOne({ instructorId: course.instructorId, studentEmail: email, courseId: course._id });

        const review = await InstructorReview.findOneAndUpdate(
            { instructorId: course.instructorId, studentEmail: email, courseId: course._id },
            {
                instructorId: course.instructorId,
                courseId: course._id,
                enrollmentId: enrollment._id,
                studentEmail: email,
                studentName: sanitizeString(enrollment.name || ""),
                rating: ratingNum,
                reviewText: sanitizeString(reviewText || ""),
                status: "pending",
            },
            { upsert: true, new: true }
        );

        // If this review was previously approved and counted in the average, drop it immediately
        if (existing?.status === "approved") {
            await recomputeInstructorRating(course.instructorId);
        }

        return res.json({ success: true, data: review });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// Fetch the current student's review (if any) for a given enrollment
export const getInstructorReviewForEnrollment = async (req, res) => {
    try {
        const { enrollmentId } = req.params;
        const { email } = req.user;

        const enrollment = await User.findOne({ _id: enrollmentId, email }).select("courseTitle").lean();
        if (!enrollment) {
            return res.status(404).json({ success: false, message: "Enrollment not found" });
        }

        const course = await Course.findOne({ courseTitle: enrollment.courseTitle, instructorId: { $exists: true, $ne: null } }).select("instructorId").lean();
        if (!course) {
            return res.json({ success: true, data: null });
        }

        const review = await InstructorReview.findOne({ instructorId: course.instructorId, studentEmail: email, courseId: course._id }).lean();
        return res.json({ success: true, data: review || null });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
