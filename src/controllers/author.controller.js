import Author from "../models/author.model.js";

const slugify = (str) =>
  (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const listAuthors = async (req, res) => {
  try {
    const authors = await Author.find({}).sort({ name: 1 }).lean();
    return res.json({ success: true, data: authors });
  } catch (error) {
    console.error("Error listing authors:", error);
    return res.status(500).json({ success: false, message: "Error listing authors" });
  }
};

export const getAuthor = async (req, res) => {
  try {
    const author = await Author.findById(req.params.id);
    if (!author) return res.status(404).json({ success: false, message: "Author not found" });
    return res.json({ success: true, data: author });
  } catch (error) {
    console.error("Error fetching author:", error);
    return res.status(500).json({ success: false, message: "Error fetching author" });
  }
};

const EDITABLE_FIELDS = ["name", "title", "bio", "expertise", "credentials", "photo", "linkedInUrl", "profileUrl", "isReviewer", "active"];

export const createAuthor = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "name is required" });
    const slug = slugify(name);
    if (slug) {
      const existing = await Author.findOne({ slug });
      if (existing) return res.status(409).json({ success: false, message: "An author with this name already exists" });
    }
    const author = await Author.create({
      name,
      slug: slug || undefined,
      title: req.body.title || "",
      bio: req.body.bio || "",
      expertise: Array.isArray(req.body.expertise) ? req.body.expertise : [],
      credentials: Array.isArray(req.body.credentials) ? req.body.credentials : [],
      photo: req.body.photo || "",
      linkedInUrl: req.body.linkedInUrl || "",
      profileUrl: req.body.profileUrl || "",
      isReviewer: !!req.body.isReviewer,
    });
    return res.status(201).json({ success: true, message: "Author created", data: author });
  } catch (error) {
    console.error("Error creating author:", error);
    return res.status(500).json({ success: false, message: "Error creating author" });
  }
};

export const updateAuthor = async (req, res) => {
  try {
    const author = await Author.findById(req.params.id);
    if (!author) return res.status(404).json({ success: false, message: "Author not found" });
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) author[field] = req.body[field];
    }
    await author.save();
    return res.json({ success: true, message: "Author updated", data: author });
  } catch (error) {
    console.error("Error updating author:", error);
    return res.status(500).json({ success: false, message: "Error updating author" });
  }
};

export const deleteAuthor = async (req, res) => {
  try {
    const author = await Author.findByIdAndDelete(req.params.id);
    if (!author) return res.status(404).json({ success: false, message: "Author not found" });
    return res.json({ success: true, message: "Author deleted" });
  } catch (error) {
    console.error("Error deleting author:", error);
    return res.status(500).json({ success: false, message: "Error deleting author" });
  }
};
