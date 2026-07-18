import mongoose from "mongoose";
import CRMTask from "../models/crm/crmTask.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";

export const getTasks = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const skip  = (page - 1) * limit;

    const { assignedTo, status, priority, dueToday, relatedToType, relatedToId, type } = req.query;
    const role    = req.crmRole || req.admin.role;
    const adminId = req.admin._id;

    const filter = { isDeleted: false };

    if (role === "sales" || role === "trainer") filter.assignedTo = adminId;
    else if (assignedTo) filter.assignedTo = new mongoose.Types.ObjectId(assignedTo);

    if (status)   filter.status   = status;
    if (priority) filter.priority = priority;
    if (type)     filter.type     = type;
    if (relatedToType) filter.relatedToType = relatedToType;
    if (relatedToId)   filter.relatedToId   = new mongoose.Types.ObjectId(relatedToId);

    if (dueToday === "true") {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end   = new Date(); end.setHours(23, 59, 59, 999);
      filter.dueDate = { $gte: start, $lte: end };
    }

    const [tasks, total] = await Promise.all([
      CRMTask.find(filter)
        .sort({ dueDate: 1, priority: -1 })
        .skip(skip).limit(limit)
        .populate("assignedTo", "name email")
        .lean(),
      CRMTask.countDocuments(filter),
    ]);

    res.json({ success: true, data: tasks, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch tasks" });
  }
};

export const getTask = async (req, res) => {
  try {
    const task = await CRMTask.findOne({ _id: req.params.id, isDeleted: false })
      .populate("assignedTo", "name email")
      .populate("comments.createdBy", "name")
      .lean();
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    res.json({ success: true, data: task });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch task" });
  }
};

export const createTask = async (req, res) => {
  try {
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: "Task title is required" });

    const task = await CRMTask.create({
      ...req.body,
      assignedTo: req.body.assignedTo || req.admin._id,
      createdBy: req.admin._id,
    });

    // Log on related entity if provided
    if (task.relatedToType && task.relatedToId) {
      await CRMActivity.create({
        type: "note",
        title: "Task created",
        body: `Task "${title}" created`,
        relatedToType: task.relatedToType,
        relatedToId: task.relatedToId,
        performedBy: req.admin._id,
        metadata: { taskId: task._id },
      });
    }

    res.status(201).json({ success: true, data: task, message: "Task created" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to create task" });
  }
};

export const updateTask = async (req, res) => {
  try {
    const task = await CRMTask.findOne({ _id: req.params.id, isDeleted: false });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const prevStatus = task.status;
    const allowed = ["title", "description", "priority", "status", "assignedTo",
      "dueDate", "reminderAt", "type", "relatedToType", "relatedToId", "checklist"];
    allowed.forEach((f) => { if (req.body[f] !== undefined) task[f] = req.body[f]; });

    if (req.body.status === "done" && prevStatus !== "done") {
      task.completedAt = new Date();

      // Log completion on parent entity
      if (task.relatedToType && task.relatedToId) {
        await CRMActivity.create({
          type: "task_done",
          title: "Task completed",
          body: `Task "${task.title}" completed`,
          relatedToType: task.relatedToType,
          relatedToId: task.relatedToId,
          performedBy: req.admin._id,
          metadata: { taskId: task._id },
        });
      }
    }

    await task.save();
    res.json({ success: true, data: task, message: "Task updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update task" });
  }
};

export const deleteTask = async (req, res) => {
  try {
    const task = await CRMTask.findOne({ _id: req.params.id, isDeleted: false });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    task.isDeleted = true;
    await task.save();
    res.json({ success: true, message: "Task deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete task" });
  }
};

export const addComment = async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ success: false, message: "Comment body required" });
    const task = await CRMTask.findOne({ _id: req.params.id, isDeleted: false });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    task.comments.push({ body: body.trim(), createdBy: req.admin._id });
    await task.save();
    res.json({ success: true, data: task.comments[task.comments.length - 1] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to add comment" });
  }
};

export const toggleChecklistItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const task = await CRMTask.findOne({ _id: req.params.id, isDeleted: false });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    const item = task.checklist.id(itemId);
    if (!item) return res.status(404).json({ success: false, message: "Checklist item not found" });
    item.done = !item.done;
    await task.save();
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to toggle checklist item" });
  }
};
