import mongoose from "mongoose";

const crmActivitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        "note", "call", "email", "meeting", "whatsapp",
        "task_done", "stage_change", "status_change", "created",
        "file_upload", "proposal_sent", "quote_sent", "deal_won",
        "deal_lost", "batch_created", "trainer_assigned", "certificate_issued",
        "merged", "ai_draft", "assigned",
      ],
    },
    title: { type: String, trim: true },
    body: { type: String, trim: true },

    // Polymorphic — ties activity to any entity in the lifecycle
    relatedToType: {
      type: String,
      required: true,
      enum: ["lead", "contact", "company", "deal", "task", "batch"],
    },
    relatedToId: { type: mongoose.Schema.Types.ObjectId, required: true },

    // Flexible metadata per activity type
    metadata: {
      type: Object,
      default: {},
      // Examples:
      // call: { duration: 300, outcome: 'left_voicemail' }
      // stage_change: { from: 'new', to: 'discovery' }
      // email: { subject: '...', messageId: '...' }
      // meeting: { link: '...', at: Date }
    },

    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "CrmUser" },
  },
  { timestamps: true }
);

crmActivitySchema.index({ relatedToType: 1, relatedToId: 1, createdAt: -1 });
crmActivitySchema.index({ performedBy: 1, createdAt: -1 });
crmActivitySchema.index({ type: 1 });
crmActivitySchema.index({ createdAt: -1 });
// Lookups by external ids kept in metadata: Resend message (delivery tracking),
// Meta leadgen (webhook idempotency) and website order (paid-order sync).
crmActivitySchema.index({ "metadata.resendId": 1 }, { sparse: true });
crmActivitySchema.index({ "metadata.leadgenId": 1 }, { sparse: true });
crmActivitySchema.index({ "metadata.orderId": 1 }, { sparse: true });

export default mongoose.model("CRMActivity", crmActivitySchema);
