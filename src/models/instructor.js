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
    coverLetter : {
        type : String
    },
    resumeUrl :{
        type : String,
        required : true
    },
    resumePublicId: {
        type : String,
        required : true
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