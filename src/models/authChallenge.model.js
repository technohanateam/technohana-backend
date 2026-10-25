import mongoose from "mongoose";

// Short-lived sign-in proofs (email magic links, WhatsApp codes). Kept off User because
// User.email isn't unique — one doc per enrollment.
const authChallengeSchema = new mongoose.Schema({
  kind: { type: String, enum: ["magic", "wa_otp"], required: true },
  identifier: { type: String, required: true }, // lowercased email, or E.164 phone
  hash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

authChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
authChallengeSchema.index({ kind: 1, identifier: 1 });
authChallengeSchema.index({ kind: 1, hash: 1 });

export const AuthChallenge = mongoose.model("AuthChallenge", authChallengeSchema);
