import mongoose, { Schema } from "mongoose";

const seoCampaignSchema = new Schema({
  campaign: { type: String, required: true },
  targetAudience: String,
  startDate: Date,
  endDate: Date,
  status: {
    type: String,
    enum: ["planned", "active", "paused", "completed"],
    default: "planned",
    index: true,
  },
  objective: String,
  notes: String,

  sourceKey: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

seoCampaignSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const SeoCampaign = mongoose.model("SeoCampaign", seoCampaignSchema);
export default SeoCampaign;
