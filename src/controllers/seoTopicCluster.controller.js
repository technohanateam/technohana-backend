import SeoTopicCluster from "../models/seoTopicCluster.model.js";
import { Blogs } from "../models/blogs.model.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

const slugify = (str) =>
  (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const listClusters = async (req, res) => {
  try {
    const { pillarCategory, status } = req.query;
    const filter = {};
    if (pillarCategory) filter.pillarCategory = pillarCategory;
    if (status) filter.status = status;
    const clusters = await SeoTopicCluster.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: clusters });
  } catch (error) {
    console.error("Error listing topic clusters:", error);
    return res.status(500).json({ success: false, message: "Error listing topic clusters" });
  }
};

export const getCluster = async (req, res) => {
  try {
    const cluster = await SeoTopicCluster.findById(req.params.id).populate("blogIds", "title slug category contentType");
    if (!cluster) return res.status(404).json({ success: false, message: "Topic cluster not found" });
    return res.json({ success: true, data: cluster });
  } catch (error) {
    console.error("Error fetching topic cluster:", error);
    return res.status(500).json({ success: false, message: "Error fetching topic cluster" });
  }
};

const EDITABLE_FIELDS = ["name", "pillarCategory", "description", "blogIds", "courseIds", "status"];

export const createCluster = async (req, res) => {
  try {
    const { name, pillarCategory } = req.body;
    if (!name || !pillarCategory) {
      return res.status(400).json({ success: false, message: "name and pillarCategory are required" });
    }
    const slug = slugify(name);
    if (slug) {
      const existing = await SeoTopicCluster.findOne({ slug });
      if (existing) return res.status(409).json({ success: false, message: "A topic cluster with this name already exists" });
    }
    const cluster = await SeoTopicCluster.create({
      name,
      slug: slug || undefined,
      pillarCategory,
      description: req.body.description || "",
      blogIds: Array.isArray(req.body.blogIds) ? req.body.blogIds : [],
      courseIds: Array.isArray(req.body.courseIds) ? req.body.courseIds : [],
      status: req.body.status || "draft",
    });
    await logSeoAudit(req, "topic-cluster-created", "SeoTopicCluster", cluster._id.toString(), { name });
    return res.status(201).json({ success: true, message: "Topic cluster created", data: cluster });
  } catch (error) {
    console.error("Error creating topic cluster:", error);
    return res.status(500).json({ success: false, message: "Error creating topic cluster" });
  }
};

export const updateCluster = async (req, res) => {
  try {
    const cluster = await SeoTopicCluster.findById(req.params.id);
    if (!cluster) return res.status(404).json({ success: false, message: "Topic cluster not found" });
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) cluster[field] = req.body[field];
    }
    await cluster.save();
    await logSeoAudit(req, "topic-cluster-updated", "SeoTopicCluster", cluster._id.toString(), {});
    return res.json({ success: true, message: "Topic cluster updated", data: cluster });
  } catch (error) {
    console.error("Error updating topic cluster:", error);
    return res.status(500).json({ success: false, message: "Error updating topic cluster" });
  }
};

export const deleteCluster = async (req, res) => {
  try {
    const cluster = await SeoTopicCluster.findByIdAndDelete(req.params.id);
    if (!cluster) return res.status(404).json({ success: false, message: "Topic cluster not found" });
    await logSeoAudit(req, "topic-cluster-deleted", "SeoTopicCluster", req.params.id, { name: cluster.name });
    return res.json({ success: true, message: "Topic cluster deleted" });
  } catch (error) {
    console.error("Error deleting topic cluster:", error);
    return res.status(500).json({ success: false, message: "Error deleting topic cluster" });
  }
};

// Read-only suggestion scan: looks at existing Blogs whose category/tags
// overlap the cluster's pillarCategory, and returns candidates for an admin
// to review and accept — never writes to the cluster itself.
export const suggestClusterMembers = async (req, res) => {
  try {
    const cluster = await SeoTopicCluster.findById(req.params.id).lean();
    if (!cluster) return res.status(404).json({ success: false, message: "Topic cluster not found" });

    const existingBlogIds = new Set((cluster.blogIds || []).map((id) => id.toString()));
    const pillarNeedle = cluster.pillarCategory.toLowerCase();

    const candidates = await Blogs.find(
      { published: true },
      { title: 1, slug: 1, category: 1, tags: 1, contentType: 1 }
    )
      .limit(500)
      .lean();

    const suggestedBlogs = candidates
      .filter((blog) => !existingBlogIds.has(blog._id.toString()))
      .filter((blog) => {
        const categoryMatch = (blog.category || "").toLowerCase().includes(pillarNeedle);
        const tagMatch = (blog.tags || []).some((tag) => tag.toLowerCase().includes(pillarNeedle));
        return categoryMatch || tagMatch;
      })
      .slice(0, 25)
      .map((blog) => ({
        blogId: blog._id,
        title: blog.title,
        slug: blog.slug,
        category: blog.category,
        contentType: blog.contentType,
      }));

    return res.json({ success: true, data: { suggestedBlogs } });
  } catch (error) {
    console.error("Error suggesting topic cluster members:", error);
    return res.status(500).json({ success: false, message: "Error suggesting topic cluster members" });
  }
};
