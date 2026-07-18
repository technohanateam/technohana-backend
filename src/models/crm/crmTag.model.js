import mongoose from "mongoose";

const crmTagSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    color: { type: String, default: "#8B5CF6" },
    category: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

export default mongoose.model("CRMTag", crmTagSchema);
