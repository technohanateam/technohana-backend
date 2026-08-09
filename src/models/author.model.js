import mongoose, { Schema } from "mongoose";

const authorSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, unique: true, sparse: true },
    title: { type: String },
    bio: { type: String },
    expertise: { type: [String], default: [] },
    credentials: { type: [String], default: [] },
    photo: { type: String },
    linkedInUrl: { type: String },
    profileUrl: { type: String },
    isReviewer: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Author = mongoose.model("Author", authorSchema);
export default Author;
