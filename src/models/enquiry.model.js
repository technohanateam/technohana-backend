import mongoose from "mongoose";

const enquirySchema = new mongoose.Schema({
  name: { type: String, required: true },
  // Optional: some enquiry types (e.g. "Request a Callback") intentionally
  // collect a phone number instead of an email.
  email: { type: String },
  phone: { type: String },
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
  teamSize: { type: String },
  partnerType: { type: String },
  roleCategory: { type: String },
  numOpenings: { type: String },
  domain: { type: String },
  requirements: { type: String },
  timeline: { type: String },
  selectedPackage: { type: String },
  source: { type: String },
  campaign: { type: String },
  landingPage: { type: String },
  pipeline: { type: String },
  serviceLine: { type: String },
  utm: { type: Object },
  // Form answers with no column of their own (budget, industry, participants, quiz
  // answers…), kept as strings so nothing a visitor submits is silently dropped.
  details: { type: Map, of: String, default: undefined },
  status: {
    type: String,
    enum: ["new", "contacted", "quoted", "won", "lost"],
    default: "new",
  },
  lostReason: { type: String, default: "" },
  notes: { type: String, default: "" },
  activities: {
    type: [{
      type: { type: String, enum: ["status_change", "note_added", "assigned", "followup_set", "created"], required: true },
      actor: { type: String, default: "Admin" },
      note: { type: String },
      from: { type: String },
      to: { type: String },
      at: { type: Date, default: Date.now },
    }],
    default: [],
  },
  assignedTo: { type: String, default: "" },
  nextFollowUp: { type: Date, default: null },
  aiScore: { type: Number, default: null, min: 0, max: 100 },
  aiScoreBand: { type: String, enum: ["hot", "warm", "cold", null], default: null },
  aiReasoning: { type: String, default: "" },
  aiDraftReply: { type: String, default: "" },
  aiSuggestedFollowUp: { type: Date, default: null },
  aiScoredAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  crmLeadId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMLead", default: null },
});

// Global Search routes email/phone lookups to an exact match, which these
// make an index scan instead of a collection scan.
enquirySchema.index({ email: 1 });
enquirySchema.index({ phone: 1 });

export default mongoose.model("Enquiry", enquirySchema);
