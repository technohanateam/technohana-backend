import mongoose from "mongoose";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMTag from "../models/crm/crmTag.model.js";

export const getActivities = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const skip  = (page - 1) * limit;

    const { relatedToType, relatedToId, type } = req.query;
    if (relatedToId && !mongoose.Types.ObjectId.isValid(relatedToId)) {
      return res.status(400).json({ success: false, message: "Invalid relatedToId" });
    }
    const filter = {};

    if (relatedToType) filter.relatedToType = relatedToType;
    if (relatedToId)   filter.relatedToId   = new mongoose.Types.ObjectId(relatedToId);
    if (type)          filter.type          = type;

    const [activities, total] = await Promise.all([
      CRMActivity.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit)
        .populate("performedBy", "name email")
        .lean(),
      CRMActivity.countDocuments(filter),
    ]);

    res.json({ success: true, data: activities, meta: { page, limit, total } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch activities" });
  }
};

export const logActivity = async (req, res) => {
  try {
    const { type, title, body, relatedToType, relatedToId, metadata } = req.body;

    if (!type || !relatedToType || !relatedToId) {
      return res.status(400).json({ success: false, message: "type, relatedToType, and relatedToId are required" });
    }

    const activity = await CRMActivity.create({
      type, title, body, relatedToType, relatedToId, metadata,
      performedBy: req.admin._id,
    });

    res.status(201).json({ success: true, data: activity, message: "Activity logged" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to log activity" });
  }
};

// ── Tags ─────────────────────────────────────────────────────────────────────

export const getTags = async (req, res) => {
  try {
    const tags = await CRMTag.find().sort({ name: 1 }).lean();
    res.json({ success: true, data: tags });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch tags" });
  }
};

export const createTag = async (req, res) => {
  try {
    const { name, color, category } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: "Tag name is required" });
    const exists = await CRMTag.exists({ name: name.trim() });
    if (exists) return res.status(409).json({ success: false, message: "Tag already exists" });
    const tag = await CRMTag.create({ name: name.trim(), color, category, createdBy: req.admin._id });
    res.status(201).json({ success: true, data: tag });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to create tag" });
  }
};

export const deleteTag = async (req, res) => {
  try {
    await CRMTag.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Tag deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete tag" });
  }
};
