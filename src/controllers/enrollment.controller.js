// this file contains the controller for user enrollment

import {User} from "../models/user.model.js";
import { generateEnrollmentConfirmationEmail, generateEnquiryTable } from "../utils/emailTemplate.js";
import { sendEmail } from "../config/emailService.js";
export const enrollUser = async (req,res) => {
    try {
        const {name,email,phone,company,trainingPeriod,specialRequest,trainingLocation,courseTitle,userType,trainingType,price,currency} = req.body;
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
            await sendEmail(
                email,
                "Enrollment Request Received - Technohana",
                generateEnrollmentConfirmationEmail({name,courseTitle}),
            )
        } catch (mailErr) {
            console.error("Failed to send enrollment confirmation email:", mailErr);
        }

        // Send notification email to admin
        try {
            await sendEmail(
                "sales@technohana.com",
                "New Course Enrollment: " + courseTitle,
                generateEnquiryTable({name,email,phone,company,trainingPeriod,specialRequest,trainingLocation,courseTitle,userType,trainingType,price,currency}),
            )
        } catch (mailErr) {
            console.error("Failed to send admin notification email:", mailErr);
        }

        return res.status(201).json({
            success : true,
            message : "Enrollment form submitted successfully",
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            message : "Internal server error",
        })
    }
}


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
