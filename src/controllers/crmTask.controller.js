import CRMTask from "../models/crm/crmTask.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import {
  parsePaging, isValidId, pick, taskOwnerFilter, canAccessRelated, activeUserExists, sendCrmError, attachRelated,
} from "../utils/crmQuery.js";
import { resolveRange } from "../services/crmDailyReport.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TASK_FIELDS = ["title", "description", "priority", "status", "dueDate", "reminderAt", "type",
  "relatedToType", "relatedToId", "checklist"];

const notFound = (res) => res.status(404).json({ success: false, message: "Task not found" });

const findScopedTask = (req, id) =>
  (isValidId(String(id)) ? CRMTask.findOne({ _id: id, isDeleted: false, ...taskOwnerFilter(req) }) : null);

// Checklist items carry only text/done (and their own _id when editing).
const cleanChecklist = (items) => (Array.isArray(items)
  ? items.filter((i) => typeof i?.text === "string" && i.text.trim())
    .map((i) => ({ ...(isValidId(String(i._id)) && { _id: i._id }), text: i.text.trim(), done: !!i.done }))
  : undefined);

async function validateTaskInput(req, fields) {
  if (fields.relatedToType || fields.relatedToId) {
    if (!(await canAccessRelated(req, fields.relatedToType, String(fields.relatedToId)))) return "Invalid related record";
  }
  if (req.body.assignedTo && !(await activeUserExists(req.body.assignedTo))) return "Invalid assignee";
  return null;
}

export const getTasks = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req.query);

    const { assignedTo, status, priority, dueToday, overdue, search, relatedToType, relatedToId, type } = req.query;
    for (const [key, val] of [["assignedTo", assignedTo], ["relatedToId", relatedToId]]) {
      if (val && !isValidId(val)) return res.status(400).json({ success: false, message: `Invalid ${key} id` });
    }

    const filter = { isDeleted: false };
    const and = [];
    const scope = taskOwnerFilter(req);
    if (scope.$or) and.push(scope);

    if (assignedTo) filter.assignedTo = assignedTo;
    if (status)   filter.status   = status;
    if (priority) filter.priority = priority;
    if (type)     filter.type     = type;
    if (relatedToType) filter.relatedToType = relatedToType;
    if (relatedToId)   filter.relatedToId   = relatedToId;

    // Due dates are IST calendar days, matching the dashboard and daily report.
    const { start: todayStart, end: todayEnd } = resolveRange();
    if (dueToday === "true") {
      filter.dueDate = { $gte: todayStart, $lt: todayEnd };
    } else if (overdue === "true") {
      filter.dueDate = { $lt: todayStart };
      filter.status = { $in: ["open", "in_progress"] };
    }

    if (search?.trim()) {
      const re = new RegExp(escapeRegex(search.trim()), "i");
      and.push({ $or: [{ title: re }, { description: re }] });
    }
    if (and.length) filter.$and = and;

    const [tasks, total] = await Promise.all([
      CRMTask.find(filter)
        .sort({ dueDate: 1, priority: -1 })
        .skip(skip).limit(limit)
        .populate("assignedTo", "name email")
        .lean(),
      CRMTask.countDocuments(filter),
    ]);

    res.json({ success: true, data: await attachRelated(tasks), meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch tasks");
  }
};

export const getTask = async (req, res) => {
  try {
    const query = findScopedTask(req, req.params.id);
    const task = query && await query
      .populate("assignedTo", "name email")
      .populate("comments.createdBy", "name")
      .lean();
    if (!task) return notFound(res);
    const [withRelated] = await attachRelated([task]);
    res.json({ success: true, data: withRelated });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch task");
  }
};

export const createTask = async (req, res) => {
  try {
    const { title } = req.body;
    if (typeof title !== "string" || !title.trim()) return res.status(400).json({ success: false, message: "Task title is required" });

    const fields = pick(req.body, TASK_FIELDS);
    if (fields.checklist !== undefined) fields.checklist = cleanChecklist(fields.checklist);
    const invalid = await validateTaskInput(req, fields);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const task = await CRMTask.create({
      ...fields,
      title: title.trim(),
      assignedTo: req.body.assignedTo || req.admin._id,
      createdBy: req.admin._id,
    });

    if (task.relatedToType && task.relatedToId) {
      await CRMActivity.create({
        type: "note",
        title: "Task created",
        body: `Task "${task.title}" created`,
        relatedToType: task.relatedToType,
        relatedToId: task.relatedToId,
        performedBy: req.admin._id,
        metadata: { taskId: task._id },
      });
    }

    res.status(201).json({ success: true, data: task, message: "Task created" });
  } catch (err) {
    sendCrmError(res, err, "Failed to create task");
  }
};

export const updateTask = async (req, res) => {
  try {
    const query = findScopedTask(req, req.params.id);
    const task = query && await query;
    if (!task) return notFound(res);

    const fields = pick(req.body, TASK_FIELDS);
    if (fields.checklist !== undefined) fields.checklist = cleanChecklist(fields.checklist);
    const relatedChanged = (fields.relatedToType !== undefined && fields.relatedToType !== task.relatedToType)
      || (fields.relatedToId !== undefined && String(fields.relatedToId) !== String(task.relatedToId));
    const invalid = await validateTaskInput(req, relatedChanged
      ? { relatedToType: fields.relatedToType ?? task.relatedToType, relatedToId: fields.relatedToId ?? task.relatedToId }
      : {});
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const prevStatus = task.status;
    const prevReminder = task.reminderAt ? new Date(task.reminderAt).getTime() : null;
    Object.assign(task, fields);
    const nextReminder = task.reminderAt ? new Date(task.reminderAt).getTime() : null;
    if (nextReminder !== prevReminder) task.reminderSentAt = null;
    if (req.body.assignedTo) task.assignedTo = req.body.assignedTo;

    let completedActivity = null;
    if (fields.status === "done" && prevStatus !== "done") {
      task.completedAt = new Date();
      if (task.relatedToType && task.relatedToId) {
        completedActivity = {
          type: "task_done",
          title: "Task completed",
          body: `Task "${task.title}" completed`,
          relatedToType: task.relatedToType,
          relatedToId: task.relatedToId,
          performedBy: req.admin._id,
          metadata: { taskId: task._id },
        };
      }
    } else if (fields.status && fields.status !== "done") {
      task.completedAt = undefined;
    }

    await task.save();
    if (completedActivity) await CRMActivity.create(completedActivity);
    res.json({ success: true, data: task, message: "Task updated" });
  } catch (err) {
    sendCrmError(res, err, "Failed to update task");
  }
};

export const deleteTask = async (req, res) => {
  try {
    const query = findScopedTask(req, req.params.id);
    const task = query && await query;
    if (!task) return notFound(res);
    task.isDeleted = true;
    await task.save();
    res.json({ success: true, message: "Task deleted" });
  } catch (err) {
    sendCrmError(res, err, "Failed to delete task");
  }
};

export const addComment = async (req, res) => {
  try {
    const { body } = req.body;
    if (typeof body !== "string" || !body.trim()) return res.status(400).json({ success: false, message: "Comment body required" });
    const query = findScopedTask(req, req.params.id);
    const task = query && await query;
    if (!task) return notFound(res);
    task.comments.push({ body: body.trim(), createdBy: req.admin._id });
    await task.save();
    res.json({ success: true, data: task.comments[task.comments.length - 1] });
  } catch (err) {
    sendCrmError(res, err, "Failed to add comment");
  }
};

export const toggleChecklistItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const query = findScopedTask(req, req.params.id);
    const task = query && await query;
    if (!task) return notFound(res);
    const item = isValidId(itemId) && task.checklist.id(itemId);
    if (!item) return res.status(404).json({ success: false, message: "Checklist item not found" });
    item.done = !item.done;
    await task.save();
    res.json({ success: true, data: item });
  } catch (err) {
    sendCrmError(res, err, "Failed to toggle checklist item");
  }
};
