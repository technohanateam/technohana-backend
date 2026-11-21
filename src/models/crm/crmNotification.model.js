import mongoose, { Schema } from "mongoose";

const crmNotificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "CrmUser", required: true },
  type: { type: String, enum: ["lead_assigned"], default: "lead_assigned" },
  // Set for a single lead; a bulk assignment is one notification with `count` and no lead.
  lead: { type: Schema.Types.ObjectId, ref: "CRMLead", default: null },
  title: { type: String, required: true, maxlength: 200 },
  body: { type: String, default: "", maxlength: 500 },
  count: { type: Number, default: 1 },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, expires: 30 * 24 * 60 * 60 },
});

crmNotificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

export default mongoose.models.CrmNotification || mongoose.model("CrmNotification", crmNotificationSchema);
