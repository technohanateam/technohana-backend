import mongoose from "mongoose";

const stageSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    order: { type: Number, required: true },
    probability: { type: Number, min: 0, max: 100, default: 20 },
    color: { type: String, default: "#8B5CF6" },
    isWon: { type: Boolean, default: false },
    isLost: { type: Boolean, default: false },
  },
  { _id: false }
);

const crmPipelineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["corporate", "individual", "consulting", "ai_projects", "certification"],
      default: "corporate",
    },
    description: { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    stages: [stageSchema],
    currency: { type: String, default: "INR" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

crmPipelineSchema.index({ isDefault: 1 });
crmPipelineSchema.index({ isActive: 1 });

export default mongoose.model("CRMPipeline", crmPipelineSchema);
