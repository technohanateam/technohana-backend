import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMTag from "../models/crm/crmTag.model.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMCompany from "../models/crm/crmCompany.model.js";
import { parsePaging, attachRelated, isValidId, isOwnerScoped, canAccessRelated, sendCrmError } from "../utils/crmQuery.js";

// System events (deal_won, stage_change, …) are written by the server; people log these.
const LOGGABLE_TYPES = ["note", "call", "email", "meeting", "whatsapp"];

const plainObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

export const getActivities = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 30 });

    const { relatedToType, relatedToId, type } = req.query;
    if (relatedToId && !isValidId(relatedToId)) {
      return res.status(400).json({ success: false, message: "Invalid relatedToId" });
    }
    if (relatedToId && !(await canAccessRelated(req, relatedToType, relatedToId))) {
      return res.status(404).json({ success: false, message: "Record not found" });
    }

    const filter = {};
    if (relatedToType) filter.relatedToType = relatedToType;
    if (relatedToId)   filter.relatedToId   = relatedToId;
    if (type)          filter.type          = type;

    // A rep sees what they did plus everything on their own leads and deals.
    if (isOwnerScoped(req) && !relatedToId) {
      const me = req.admin._id;
      const [leadIds, dealIds] = await Promise.all([
        CRMLead.distinct("_id", { assignedTo: me }),
        CRMDeal.distinct("_id", { assignedTo: me }),
      ]);
      filter.$or = [
        { performedBy: me },
        { relatedToType: "lead", relatedToId: { $in: leadIds } },
        { relatedToType: "deal", relatedToId: { $in: dealIds } },
      ];
    }

    const [activities, total] = await Promise.all([
      CRMActivity.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit)
        .populate("performedBy", "name email")
        .lean(),
      CRMActivity.countDocuments(filter),
    ]);

    res.json({ success: true, data: await attachRelated(activities), meta: { page, limit, total } });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch activities");
  }
};

export const logActivity = async (req, res) => {
  try {
    const { type, title, body, relatedToType, relatedToId, metadata } = req.body;

    if (!LOGGABLE_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of: ${LOGGABLE_TYPES.join(", ")}` });
    }
    if (!(await canAccessRelated(req, relatedToType, String(relatedToId)))) {
      return res.status(400).json({ success: false, message: "Invalid related record" });
    }

    const activity = await CRMActivity.create({
      type,
      title: typeof title === "string" ? title.slice(0, 200) : undefined,
      body: typeof body === "string" ? body.slice(0, 10000) : undefined,
      relatedToType,
      relatedToId,
      metadata: plainObject(metadata),
      performedBy: req.admin._id,
    });

    res.status(201).json({ success: true, data: activity, message: "Activity logged" });
  } catch (err) {
    sendCrmError(res, err, "Failed to log activity");
  }
};

// ── Tags ─────────────────────────────────────────────────────────────────────

export const getTags = async (req, res) => {
  try {
    const tags = await CRMTag.find().sort({ name: 1 }).limit(500).lean();
    res.json({ success: true, data: tags });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch tags");
  }
};

export const createTag = async (req, res) => {
  try {
    const { name, color, category } = req.body;
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ success: false, message: "Tag name is required" });
    const exists = await CRMTag.exists({ name: name.trim() });
    if (exists) return res.status(409).json({ success: false, message: "Tag already exists" });
    const tag = await CRMTag.create({ name: name.trim(), color, category, createdBy: req.admin._id });
    res.status(201).json({ success: true, data: tag });
  } catch (err) {
    sendCrmError(res, err, "Failed to create tag");
  }
};

export const deleteTag = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: "Tag not found" });
    await CRMTag.findByIdAndDelete(req.params.id);
    // Drop the dangling reference everywhere the tag was used.
    const pull = { $pull: { tags: req.params.id } };
    await Promise.all([CRMLead, CRMDeal, CRMContact, CRMCompany].map((m) => m.updateMany({ tags: req.params.id }, pull)));
    res.json({ success: true, message: "Tag deleted" });
  } catch (err) {
    sendCrmError(res, err, "Failed to delete tag");
  }
};
