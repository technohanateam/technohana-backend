import mongoose, { Schema } from "mongoose"
//this schema is only used when user has submitted a enrollment form 
const userSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true // allows for null values
    },
    email: {
        type: String,
        required: true
    },
    phone: {                               //kyc
        type: String,
    },
    company: {                              //kyc
        type: String,
        trim: true // Add trim to handle whitespace
    },
    userType: {                            //kyc
        type: String,
        enum: ["professional", "student", "others"],
        default: "student"
    },
    courseTitle: {
        type: String,
    },
    status: {
        type: String,
        enum: ["pending-payment", "in-progress", "rejected", "enrolled", "completed"]
    },
    orderId: {
        type: String,
        sparse: true
    },
    enrollmentToken: {
        type: String,
        sparse: true
    },
    trainingPeriod: {
        type: String,
    },
    trainingLocation: {
        type: String,
    },
    trainingType: {
        type: String,
        enum: ["individual", "group", "corporate"],
        default: "individual"
    },
    price: { type: String },
    currency: { type: String, default: "INR" },
    specialRequest: {
        type: String,
    },
    password: {
        type: String
    },
    isKyc: {
        type: Boolean,
        default: false
    },
    enrolledAt: {
        type: Date,
        sparse: true
    },
    // Progress tracking fields
    progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    lastAccessedAt: {
        type: Date,
        sparse: true
    },
    completedAt: {
        type: Date,
        sparse: true
    },
    // Certificate fields
    certificateIssued: {
        type: Boolean,
        default: false
    },
    certificateNumber: {
        type: String,
        sparse: true
    },
    // Course materials tracking
    lessonsCompleted: {
        type: Number,
        default: 0
    },
    totalLessons: {
        type: Number,
        default: 0
    },
    // Referral Program
    referralCode: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },
    referredBy: {
        type: String, // Email of the referrer
        sparse: true
    },
    referralCount: {
        type: Number,
        default: 0
    },
    referralDiscountApplied: {
        type: Boolean,
        default: false
    },
    referralDiscountPct: {
        type: Number,
        default: 10 // 10% default discount
    },
    // Abandoned Enrollment Recovery
    enrollmentFormData: {
        type: Object,
        default: null,
        // Stores: { courseTitle, trainingType, trainingLocation, trainingPeriod, specialRequest, etc }
    },
    enrollmentFormStartedAt: {
        type: Date,
        sparse: true
    },
    enrollmentFormAbandonedAt: {
        type: Date,
        sparse: true
    },
    enrollmentReminderSent: {
        type: Boolean,
        default: false
    },
    enrollmentReminderSentAt: {
        type: Date,
        sparse: true
    }
})

export const User = mongoose.model("User", userSchema);