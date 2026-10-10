import mongoose from "mongoose";

// Hostnames accepted for `kind: "link"` materials. These URLs get rendered as
// clickable links, so an open field here is a phishing vector. Anything not listed
// must be saved with provider "other", which the admin moderation view surfaces.
const ALLOWED_LINK_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
  "drive.google.com",
  "docs.google.com",
  "1drv.ms",
  "onedrive.live.com",
  "github.com",
];

const isAllowedLinkHost = (hostname) =>
  ALLOWED_LINK_HOSTS.includes(hostname) ||
  hostname.endsWith(".zoom.us") ||
  hostname.endsWith(".sharepoint.com");

const fileSchema = new mongoose.Schema(
  {
    publicId:     { type: String },
    url:          { type: String },
    secureUrl:    { type: String },
    mimeType:     { type: String },
    sizeBytes:    { type: Number },
    originalName: { type: String },
    resourceType: { type: String, enum: ["raw", "image", "video"], default: "raw" },
    format:       { type: String },
  },
  { _id: false }
);

const linkSchema = new mongoose.Schema(
  {
    url:      { type: String },
    provider: { type: String, enum: ["youtube", "vimeo", "drive", "onedrive", "zoom", "github", "other"], default: "other" },
  },
  { _id: false }
);

const courseMaterialSchema = new mongoose.Schema(
  {
    kind:        { type: String, enum: ["file", "link"], required: true },
    title:       { type: String, required: true, trim: true },
    description: { type: String },

    courseId:  { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    // null = applies to every batch of the course.
    batchId:   { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Session", default: null },

    instructorId:   { type: mongoose.Schema.Types.ObjectId, ref: "Instructor", required: true },
    uploadedByRole: { type: String, enum: ["instructor", "admin"], default: "instructor" },

    file: { type: fileSchema, default: undefined },
    link: { type: linkSchema, default: undefined },

    category: { type: String, enum: ["slides", "handout", "recording", "assignment", "dataset", "reference", "other"], default: "other" },

    // Default closed. "batch" means visible to that batch's learners once a
    // learner-facing surface exists; nothing consumes it yet.
    visibility: { type: String, enum: ["instructor-only", "batch", "public"], default: "instructor-only" },

    order:         { type: Number, default: 0 },
    downloadCount: { type: Number, default: 0 },

    // Soft delete, so Cloudinary cleanup can lag and a mistaken delete is recoverable.
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

courseMaterialSchema.pre("validate", function (next) {
  if (this.kind === "file") {
    if (!this.file?.publicId || !this.file?.secureUrl)
      return next(new Error("File materials require file.publicId and file.secureUrl"));
    this.link = undefined;
    return next();
  }

  if (this.kind === "link") {
    if (!this.link?.url) return next(new Error("Link materials require link.url"));
    let parsed;
    try {
      parsed = new URL(this.link.url);
    } catch {
      return next(new Error("link.url is not a valid URL"));
    }
    if (parsed.protocol !== "https:")
      return next(new Error("link.url must use https"));
    if (this.link.provider !== "other" && !isAllowedLinkHost(parsed.hostname))
      return next(new Error(`link.url host ${parsed.hostname} is not allowed for provider ${this.link.provider}`));
    this.file = undefined;
    return next();
  }

  return next();
});

courseMaterialSchema.index({ courseId: 1, batchId: 1, order: 1 });
courseMaterialSchema.index({ instructorId: 1, createdAt: -1 });
courseMaterialSchema.index({ batchId: 1, visibility: 1 });
courseMaterialSchema.index({ "file.publicId": 1 }, { sparse: true });

export { ALLOWED_LINK_HOSTS, isAllowedLinkHost };
export default mongoose.model("CourseMaterial", courseMaterialSchema);
