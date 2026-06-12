import mongoose from "mongoose";

const leadSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  email:   { type: String, required: true, trim: true, lowercase: true },
  persona: { type: String, required: true, trim: true },
  source:  { type: String, default: "persona_lp" },
  utm:     { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now },
});

leadSchema.index({ email: 1, persona: 1 });

export default mongoose.model("Lead", leadSchema);
