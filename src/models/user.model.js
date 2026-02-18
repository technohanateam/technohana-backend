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
        enum :["pending-payment","in-progress","rejected","enrolled"]
    },
    orderId : {
        type : String,
        sparse : true
    },
    trainingPeriod :{
        type : String,
    },
    trainingLocation :{
        type : String,
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