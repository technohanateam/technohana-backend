import mongoose from "mongoose";

const checklistItemSchema = new mongoose.Schema(
  { text: { type: String, required: true }, done: { type: Boolean, default: false } },
  { _id: true }
);

const commentSchema = new mongoose.Schema(
  { body: { type: String, required: true }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" } },
  { timestamps: true }
);

const crmTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    status: { type: String, enum: ["open", "in_progress", "done", "cancelled"], default: "open" },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
    dueDate: { type: Date },
    reminderAt: { type: Date },
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

    checklist: [checklistItemSchema],
    comments: [commentSchema],

    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
  },
  { timestamps: true }
);

crmTaskSchema.index({ assignedTo: 1, status: 1 });
crmTaskSchema.index({ dueDate: 1 });
crmTaskSchema.index({ relatedToType: 1, relatedToId: 1 });
crmTaskSchema.index({ status: 1, dueDate: 1 });
crmTaskSchema.index({ isDeleted: 1 });

export default mongoose.model("CRMTask", crmTaskSchema);
