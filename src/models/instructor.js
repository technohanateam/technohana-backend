import mongoose,{Schema} from "mongoose";

const instructorSchema = new Schema({
    name : {
        type : String,
        required : true
    },
    email : {
        type : String,
        required :true,
    },
    phone : { type : String },
    expertise : { type : String },
    experience : { type : String },
    linkedinUrl : { type : String },
    dailyRate : { type : String },
    availability : { type : String },
    deliveryMode : { type : String },
    certifications : { type : String },
    expertiseOther : { type : String },
    coverLetter : {
        type : String
    },
    resumeUrl :{
        type : String,
        default : ""
    },
    resumePublicId: {
        type : String,
        default : ""
    },
    status : {
        type : String,
        enum : ["pending","shortlisted","rejected"],
        default : "pending"
    },
    notes : { type : String, default : "" },
    assignedTo : { type : String, default : "" },
    nextFollowUp : { type : Date },
    submittedAt : {
        type : Date,
        default : Date.now
    },
    // Portal auth fields
    passwordHash : { type : String },
    resetToken : { type : String },
    resetTokenExpiry : { type : Date },
    isActive : { type : Boolean, default : false },
    lastLogin : { type : Date },
    picture : { type : String },
    avgRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    // Compliance onboarding (NDA + ethics quiz) — gates portal access, see requireCompliance middleware
    complianceStatus: {
        ndaAccepted: { type: Boolean, default: false },
        ndaAcceptedVersion: { type: String, default: "" },
        quizPassed: { type: Boolean, default: false },
        quizPassedAt: { type: Date },
    },
})

instructorSchema.index({ resetToken: 1 });
instructorSchema.index({ email: 1 });

const Instructor = mongoose.model("Instructor",instructorSchema);

export default Instructor;