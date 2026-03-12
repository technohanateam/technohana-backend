import mongoose from "mongoose";

const enquirySchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  company :{type : String},
  callBackDateTime : {
    type : Date,
  },
  userType: {
    type: String,
    enum: ["professional", "student", "others"],
  },
  trainingLocation: { type: String },
  trainingType: { 
    type: String, 
    enum: ["individual", "group", "corporate"],
    default: "individual"
  },
  price: { type: String },
  currency: { type: String, default: "INR" },
  description : {type : String},
  courseTitle: { type: String},
  courseId: { type: String},
  enquiryType: { type: String },
  expertise: { type: String },
  experience: { type: String },
  linkedinUrl: { type: String },
  requirements: { type: String },
  timeline: { type: String },
  selectedPackage: { type: String },
  source: { type: String },
  campaign: { type: String },
  landingPage: { type: String },
  pipeline: { type: String },
  serviceLine: { type: String },
  utm: { type: Object },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Enquiry", enquirySchema);
