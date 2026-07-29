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
    enum: ["new", "contacted", "follow-up", "responded", "published", "declined", "archived"],
    default: "new",
    index: true,
  },
  lastContact: Date,
  nextFollowUp: Date,
  owner: String,
  notes: String,

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
