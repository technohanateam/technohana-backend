import mongoose from "mongoose";

const noteSchema = new mongoose.Schema(
  { body: { type: String, required: true }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" } },
  { timestamps: true }
);

const crmDealSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    value: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },

    status: { type: String, enum: ["open", "won", "lost"], default: "open" },
    lostReason: { type: String, trim: true },
    wonAt: { type: Date },
    lostAt: { type: Date },

    pipeline: { type: mongoose.Schema.Types.ObjectId, ref: "CRMPipeline", required: true },
    stageKey: { type: String, required: true },
    stageOrder: { type: Number, default: 0 },
    probability: { type: Number, min: 0, max: 100, default: 20 },
    expectedCloseDate: { type: Date },

    // CRM entity links
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "CRMLead" },
    contact: { type: mongoose.Schema.Types.ObjectId, ref: "CRMContact" },
    company: { type: mongoose.Schema.Types.ObjectId, ref: "CRMCompany" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },

    // Training lifecycle links (connected as deal progresses)
    proposalId: { type: mongoose.Schema.Types.ObjectId, ref: "Proposal" },
    quotationRef: { type: String },
    purchaseOrderRef: { type: String },
    purchaseOrderUrl: { type: String },
    invoiceRef: { type: String },
    batchId: { type: String },

    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "CRMTag" }],
    notes: [noteSchema],
    attachments: [
      {
        name: String,
        url: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

crmDealSchema.index({ pipeline: 1, stageKey: 1 });
crmDealSchema.index({ status: 1 });
crmDealSchema.index({ assignedTo: 1 });
crmDealSchema.index({ lead: 1 });
crmDealSchema.index({ company: 1 });
crmDealSchema.index({ isDeleted: 1 });
crmDealSchema.index({ expectedCloseDate: 1 });

export default mongoose.model("CRMDeal", crmDealSchema);
