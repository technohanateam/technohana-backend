import mongoose, { Schema } from "mongoose";

const seoContactSchema = new Schema({
  contactName: String,
  company: String,
  website: String,
  email: String,
  role: String,
  opportunityType: String,
  status: {
    type: String,
    enum: [
      "new", "contacted", "follow-up", "responded", "published", "declined", "archived",
      // Phase 6 — additive outreach CRM stages (existing values above are kept as-is)
      "email-sent", "opened", "negotiating", "accepted", "live-link", "lost-link",
    ],
    default: "new",
    index: true,
  },
  lastContact: Date,
  nextFollowUp: Date, // doubles as the "reminder date" for Phase 6 CRM stages
  owner: String,
  notes: String,

  // Phase 6 — link back to the opportunity this contact was generated from
  opportunityId: { type: Schema.Types.ObjectId, ref: "SeoOpportunity" },

  followUps: [
    {
      followUpNumber: Number,
      scheduledDate: Date,
      completed: { type: Boolean, default: false },
      notes: String,
    },
  ],

  responses: [
    {
      response: String,
      decision: String,
      liveLink: String,
      notes: String,
      receivedAt: { type: Date, default: Date.now },
    },
  ],

  // Phase 6 — AI-generated outreach drafts. Never auto-sent; a human must call
  // the "send" endpoint to actually deliver one via sendEmail().
  aiDrafts: [
    {
      generatedAt: { type: Date, default: Date.now },
      subject: String,
      personalizedEmail: String,
      reasonForOutreach: String,
      suggestedPage: String,
      suggestedAnchorText: String,
      followUp1: String,
      followUp2: String,
      status: { type: String, enum: ["draft", "edited", "sent", "discarded"], default: "draft" },
      sentAt: Date,
      sentBy: String,
    },
  ],

  sourceKey: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

seoContactSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const SeoContact = mongoose.model("SeoContact", seoContactSchema);
export default SeoContact;
