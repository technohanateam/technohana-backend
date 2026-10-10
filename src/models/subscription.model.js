import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  subscribeTo: { type: String, default: "the latest news, courses, and AI events" },
  isActive: { type: Boolean, default: true },
  // isActive:false doubles as the marketing suppression list — see
  // services/emailSuppression.js.
  unsubscribedAt: { type: Date },
  unsubscribeReason: { type: String, enum: ["unsubscribed", "complained", "bounced", "admin"] },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Subscription", subscriptionSchema);
