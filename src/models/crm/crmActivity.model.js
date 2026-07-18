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

    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

crmActivitySchema.index({ relatedToType: 1, relatedToId: 1, createdAt: -1 });
crmActivitySchema.index({ performedBy: 1 });
crmActivitySchema.index({ type: 1 });
crmActivitySchema.index({ createdAt: -1 });

export default mongoose.model("CRMActivity", crmActivitySchema);
