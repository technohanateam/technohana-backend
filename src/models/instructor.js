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
    submittedAt : {
        type : Date,
        default : Date.now
    }
})

const Instructor = mongoose.model("Instructor",instructorSchema);

export default Instructor;