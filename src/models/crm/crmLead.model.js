import mongoose from "mongoose";

const noteSchema = new mongoose.Schema(
  { body: { type: String, required: true }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" } },
  { timestamps: true }
);

const attachmentSchema = new mongoose.Schema({
  name: String,
  url: { type: String, required: true },
  publicId: String,
  size: Number,
  mimeType: String,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
  uploadedAt: { type: Date, default: Date.now },
});

const crmLeadSchema = new mongoose.Schema(
  {
    // Identity
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    whatsApp: { type: String, trim: true },
    designation: { type: String, trim: true },
    company: { type: String, trim: true },

    // Address
    country: { type: String, trim: true },
    state: { type: String, trim: true },
    city: { type: String, trim: true },

    // Source
    source: {
      type: String,
      enum: ["website", "referral", "event", "campaign", "cold_call", "social", "partner", "chat", "enquiry_form", "other"],
      default: "website",
    },
    website: { type: String, trim: true },
    linkedIn: { type: String, trim: true },
    utm: { type: Object, default: {} },

    // Qualification
    interest: { type: String, trim: true },
    budget: { type: Number },
    currency: { type: String, default: "INR" },
    teamSize: { type: Number },
    industry: { type: String, trim: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    leadScore: { type: Number, min: 0, max: 100, default: null },
    expectedRevenue: { type: Number },
    probability: { type: Number, min: 0, max: 100, default: 20 },

    // AI Enrichment
    aiScore: { type: Number, min: 0, max: 100 },
    aiScoreBand: { type: String, enum: ["hot", "warm", "cold"] },
    aiReasoning: { type: String },
    aiSuggestedFollowUp: { type: String },
    aiScoredAt: { type: Date },

    // CRM State — this is the spine field connecting all lifecycle stages
    status: {
      type: String,
      enum: ["new", "discovery", "needs_analysis", "skill_gap_assessed", "course_recommended",
             "proposal_sent", "negotiation", "quotation_sent", "purchase_order", "won", "lost", "junk"],
      default: "new",
    },
    lostReason: { type: String, trim: true },
    wonAt: { type: Date },
    lostAt: { type: Date },

    // Pipeline linkage
    pipeline: { type: mongoose.Schema.Types.ObjectId, ref: "CRMPipeline" },
    pipelineStage: { type: String },

    // Assignments
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    nextFollowUp: { type: Date },

    // Related CRM entities (set as lead progresses)
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMContact" },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMCompany" },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMDeal" },
    proposalId: { type: mongoose.Schema.Types.ObjectId, ref: "Proposal" },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Enrichment
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "CRMTag" }],
    customFields: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    notes: [noteSchema],
    attachments: [attachmentSchema],

    // Source reference — set when lead is promoted from an Enquiry
    enquiryRef: { type: mongoose.Schema.Types.ObjectId, ref: "Enquiry", default: null },

    // Dedup
    isDuplicate: { type: Boolean, default: false },
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: "CRMLead" },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },

    // Skills gap data captured during needs analysis
    skillGapData: { type: Object },
    recommendedCourses: [{ courseId: String, courseTitle: String, reason: String }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

crmLeadSchema.index({ email: 1 });
crmLeadSchema.index({ status: 1 });
crmLeadSchema.index({ assignedTo: 1 });
crmLeadSchema.index({ pipeline: 1 });
crmLeadSchema.index({ createdAt: -1 });
crmLeadSchema.index({ leadScore: -1 });
crmLeadSchema.index({ isDeleted: 1, status: 1 });
crmLeadSchema.index({ status: 1, assignedTo: 1 });

export default mongoose.model("CRMLead", crmLeadSchema);
