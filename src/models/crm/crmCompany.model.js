import mongoose from "mongoose";

const noteSchema = new mongoose.Schema(
  { body: { type: String, required: true }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" } },
  { timestamps: true }
);

const crmCompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    gst: { type: String, trim: true },
    pan: { type: String, trim: true },
    industry: { type: String, trim: true },
    subIndustry: { type: String, trim: true },
    annualRevenue: { type: Number },
    employees: { type: Number },
    employeeRange: { type: String },

    website: { type: String, trim: true },
    linkedIn: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },

    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true },
      pincode: { type: String, trim: true },
    },

    primaryContact: { type: mongoose.Schema.Types.ObjectId, ref: "CRMContact" },

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
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

crmCompanySchema.index({ name: 1 });
crmCompanySchema.index({ industry: 1 });
crmCompanySchema.index({ isDeleted: 1 });
crmCompanySchema.index({ "address.country": 1 });

export default mongoose.model("CRMCompany", crmCompanySchema);
