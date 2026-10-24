import mongoose from "mongoose";

const checklistItemSchema = new mongoose.Schema(
  { text: { type: String, required: true }, done: { type: Boolean, default: false } },
  { _id: true }
);

const commentSchema = new mongoose.Schema(
  { body: { type: String, required: true }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "CrmUser" } },
  { timestamps: true }
);

const crmTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    status: { type: String, enum: ["open", "in_progress", "done", "cancelled"], default: "open" },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "CrmUser" },
    dueDate: { type: Date },
    reminderAt: { type: Date },
    // Set once the reminder email goes out; cleared when reminderAt changes.
    reminderSentAt: { type: Date, default: null },
    completedAt: { type: Date },

    isRecurring: { type: Boolean, default: false },
    recurrenceRule: { type: String },

    // Polymorphic relation — links task to any CRM entity
    relatedToType: { type: String, enum: ["lead", "contact", "company", "deal", "batch"] },
    relatedToId: { type: mongoose.Schema.Types.ObjectId },

    type: {
      type: String,
      enum: ["follow_up", "call", "email", "meeting", "demo", "proposal", "other"],
      default: "follow_up",
    },

    // Set on tasks created by an automated outreach sequence, so the sequence can be cancelled as a group.
    sequenceKey: { type: String },

    checklist: [checklistItemSchema],
    comments: [commentSchema],

    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "CrmUser" },
  },
  { timestamps: true }
);

crmTaskSchema.index({ assignedTo: 1, status: 1 });
crmTaskSchema.index({ dueDate: 1 });
crmTaskSchema.index({ relatedToType: 1, relatedToId: 1 });
crmTaskSchema.index({ sequenceKey: 1, status: 1 }, { sparse: true });
crmTaskSchema.index({ status: 1, dueDate: 1 });
crmTaskSchema.index({ completedAt: 1 }, { sparse: true });
crmTaskSchema.index({ reminderAt: 1, reminderSentAt: 1 });

export default mongoose.model("CRMTask", crmTaskSchema);
