import mongoose from "mongoose";

const noteSchema = new mongoose.Schema(
  { body: { type: String, required: true }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" } },
  { timestamps: true }
);

const crmContactSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    whatsApp: { type: String, trim: true },

    company: { type: mongoose.Schema.Types.ObjectId, ref: "CRMCompany" },
    designation: { type: String, trim: true },
    department: { type: String, trim: true },

    linkedIn: { type: String, trim: true },
    twitter: { type: String, trim: true },
    website: { type: String, trim: true },

    country: { type: String, trim: true },
    state: { type: String, trim: true },
    city: { type: String, trim: true },
    timezone: { type: String, trim: true },

    isDecisionMaker: { type: Boolean, default: false },
    isPrimaryContact: { type: Boolean, default: false },

    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "CRMTag" }],
    notes: [noteSchema],
    attachments: [
      {
        name: String,
        url: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    leads: [{ type: mongoose.Schema.Types.ObjectId, ref: "CRMLead" }],
    deals: [{ type: mongoose.Schema.Types.ObjectId, ref: "CRMDeal" }],

    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

crmContactSchema.index({ email: 1 });
crmContactSchema.index({ company: 1 });
crmContactSchema.index({ isDeleted: 1 });
crmContactSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName || ""}`.trim();
});

export default mongoose.model("CRMContact", crmContactSchema);
