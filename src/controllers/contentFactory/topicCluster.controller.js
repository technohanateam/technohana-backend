import TopicCluster from "../../models/topicCluster.model.js";
import { proposeTopicClusterMapping, applyTopicClusterMapping } from "../../services/contentFactory/topicClusterMapping.service.js";

export const listClusters = async (req, res) => {
  try {
    const clusters = await TopicCluster.find().sort({ priority: -1, name: 1 }).lean();
    return res.json({ success: true, data: clusters });
  } catch (err) {
    console.error("[ContentFactory] listClusters error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createCluster = async (req, res) => {
  try {
    const { name, slug, description, categories, priority } = req.body || {};
    if (!name || !slug) return res.status(400).json({ success: false, message: "name and slug are required" });

    const cluster = await TopicCluster.create({ name, slug, description, categories, priority });
    return res.status(201).json({ success: true, data: cluster, message: "Cluster created" });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: "A cluster with that slug already exists" });
    console.error("[ContentFactory] createCluster error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const updateCluster = async (req, res) => {
  try {
    const { name, description, categories, priority } = req.body || {};
    const update = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (categories !== undefined) update.categories = categories;
    if (priority !== undefined) update.priority = priority;

    const cluster = await TopicCluster.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!cluster) return res.status(404).json({ success: false, message: "Cluster not found" });
    return res.json({ success: true, data: cluster, message: "Cluster updated" });
  } catch (err) {
    console.error("[ContentFactory] updateCluster error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const deleteCluster = async (req, res) => {
  try {
    const cluster = await TopicCluster.findByIdAndDelete(req.params.id);
    if (!cluster) return res.status(404).json({ success: false, message: "Cluster not found" });
    return res.json({ success: true, message: "Cluster deleted" });
  } catch (err) {
    console.error("[ContentFactory] deleteCluster error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/clusters/propose-mapping — AI proposal only, never persisted.
export const proposeMapping = async (req, res) => {
  try {
    const proposal = await proposeTopicClusterMapping();
    return res.json({ success: true, data: proposal });
  } catch (err) {
    console.error("[ContentFactory] proposeMapping error:", err);
    return res.status(500).json({ success: false, message: "AI proposal failed" });
  }
};

// POST /admin/content-factory/clusters/apply-mapping — persists an admin-confirmed proposal.
export const applyMapping = async (req, res) => {
  try {
    const clusters = req.body?.clusters;
    const applied = await applyTopicClusterMapping(clusters);
    return res.json({ success: true, data: applied, message: "Topic cluster mapping applied" });
  } catch (err) {
    console.error("[ContentFactory] applyMapping error:", err);
    return res.status(400).json({ success: false, message: err.message || "Failed to apply mapping" });
  }
};
