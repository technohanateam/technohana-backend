import mongoose from "mongoose";

const questionCommentSchema = new mongoose.Schema({
  examCode: { type: String, required: true, uppercase: true, trim: true },
  questionKey: { type: String, required: true, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  picture: { type: String, default: null },
  text: { type: String, required: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now },
});

questionCommentSchema.index({ examCode: 1, createdAt: -1 });

export default mongoose.model("QuestionComment", questionCommentSchema);
