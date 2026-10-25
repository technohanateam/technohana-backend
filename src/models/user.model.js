import mongoose, { Schema } from "mongoose"
import { normalizePhone } from "../utils/phone.js"
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
    phoneE164: {                           // derived from phone by the hooks below; used for WhatsApp OTP sign-in
        type: String,
        index: true
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
    batchDate: {
        type: Date,
    },
    batchTime: {
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
    city: { type: String },
    participants: { type: Number },
    couponCode: { type: String },
    rejectionReason: {
        type: String,
    },
    picture: {
        type: String
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
    },
    day3EmailSent: {
        type: Boolean,
        default: false
    },
    day7EmailSent: {
        type: Boolean,
        default: false
    },
    utm: { type: Object },
    // Enrollment status audit trail
    statusChangedBy: { type: String, default: null },
    statusChangedAt: { type: Date, default: null },
    // Cohort assignment. The operational truth for rosters and attendance — the
    // free-text batchDate/batchTime fields above stay as display copy and are still
    // written by the enrollment flow, but cannot distinguish two concurrent cohorts.
    // Attendance can only be marked for enrollments that have a batchId.
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", sparse: true },
    assignedToBatchAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
})

// Global Search routes email/phone lookups to an exact match, which these
// make an index scan instead of a collection scan.
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ batchId: 1, status: 1 });

// Keep phoneE164 in step with phone however it gets written (create, save, findByIdAndUpdate...).
userSchema.pre("save", function () {
    if (this.isModified("phone")) this.phoneE164 = normalizePhone(this.phone);
});
for (const op of ["findOneAndUpdate", "updateOne"]) {
    userSchema.pre(op, function () {
        const update = this.getUpdate() || {};
        const target = update.$set || update;
        if (target.phone !== undefined) {
            target.phoneE164 = normalizePhone(target.phone);
            if (update.$set) update.$set = target; else this.setUpdate(update);
        }
    });
}

export const User = mongoose.model("User", userSchema);