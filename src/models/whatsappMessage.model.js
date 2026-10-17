import mongoose from "mongoose";

const whatsappMessageSchema = new mongoose.Schema(
  {
    direction: { type: String, enum: ["out", "in"], required: true },
    phone: { type: String, required: true, index: true },
    waMessageId: { type: String, unique: true, sparse: true },
    type: { type: String, default: "text" },
    templateName: String,
    body: String,
    status: { type: String, enum: ["queued", "sent", "delivered", "read", "failed", "received"], default: "queued" },
    error: String,
    // Polymorphic link to the lead/contact/user/enrollment this message belongs to
    relatedToType: { type: String, enum: ["lead", "contact", "user", "enrollment"] },
    relatedToId: { type: mongoose.Schema.Types.ObjectId },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "CrmUser" },
    statusAt: {
      sent: Date, delivered: Date, read: Date, failed: Date,
    },
  },
  { timestamps: true }
);

whatsappMessageSchema.index({ relatedToType: 1, relatedToId: 1, createdAt: -1 });
whatsappMessageSchema.index({ phone: 1, direction: 1, createdAt: -1 });

export default mongoose.model("WhatsAppMessage", whatsappMessageSchema);
