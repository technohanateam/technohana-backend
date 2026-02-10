import mongoose,{Schema} from "mongoose"
//this schema is only used when user has submitted a enrollment form 
const userSchema = new Schema({
    name :{                         
        type :String,
        required : true
    },
    googleId : {
        type : String,
        unique : true,
        sparse : true // allows for null values
    },
    email : {
        type : String,
        required : true
    },
    phone :{                               //kyc
        type : String,
    },
    company:{                              //kyc
        type : String,
        trim: true // Add trim to handle whitespace
    },
    userType :{                            //kyc
        type : String,
        enum : ["professional","student","others"],
        default : "student"
    },
    courseTitle:{
        type : String,
    },
    status : {
        type : String,
        enum :["in-progress","rejected","enrolled"]
    },
    trainingPeriod :{
        type : String,
        enum : ["4 hours per day","8 hours per day"],
    },
    trainingLocation :{
        type : String,
        enum : ["Technohana-Office","onsite","online"],
    },
    trainingType: {
        type: String,
        enum: ["individual", "group", "corporate"],
        default: "individual"
    },
    price: { type: String },
    currency: { type: String, default: "INR" },
    specialRequest :{
        type : String,
    },
    password :{
        type : String
    },
    isKyc :{
        type : Boolean,
        default : false
    }
})

export const User = mongoose.model("User",userSchema);