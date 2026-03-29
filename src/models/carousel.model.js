import mongoose from "mongoose";

const SlideSchema = new mongoose.Schema(
  {
    order:       { type: Number, required: true },
    headline:    { type: String, default: "" },
    body:        { type: String, default: "" },
    imageUrl:    { type: String, default: "" },
  },
  { _id: false }
);

const CarouselSchema = new mongoose.Schema(
  {
    title:     { type: String, required: true },
    topic:     { type: String, default: "" },
    theme:     { type: String, enum: ["minimal", "bold", "gradient", "dark"], default: "minimal" },
    slides:    { type: [SlideSchema], default: [] },
    status:    { type: String, enum: ["draft", "ready", "published"], default: "draft" },
    isTemplate: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Carousel", CarouselSchema);
