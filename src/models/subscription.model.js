import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  subscribeTo: { type: String, default: "the latest news, courses, and AI events" },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Subscription", subscriptionSchema); 