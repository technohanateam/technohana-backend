import mongoose from "mongoose";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const logActivity = async (contactId, type, title, body, performedBy, metadata = {}) => {
  try {
    await CRMActivity.create({ type, title, body, metadata, relatedToType: "contact", relatedToId: contactId, performedBy });
  } catch (e) { console.error("Activity log failed:", e.message); }
};

export const getContacts = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const skip  = (page - 1) * limit;

    const { search, company, isDecisionMaker } = req.query;
    const filter = { isDeleted: false };

    if (company)         filter.company = new mongoose.Types.ObjectId(company);
    if (isDecisionMaker) filter.isDecisionMaker = true;
    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ firstName: re }, { lastName: re }, { email: re }, { phone: re }];
    }

    const [contacts, total] = await Promise.all([
      CRMContact.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("company", "name industry")
        .populate("tags", "name color")
        .lean(),
      CRMContact.countDocuments(filter),
    ]);

    res.json({ success: true, data: contacts, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch contacts" });
  }
};

export const getContact = async (req, res) => {
  try {
    const contact = await CRMContact.findOne({ _id: req.params.id, isDeleted: false })
      .populate("company", "name industry website")
      .populate("tags", "name color")
      .lean();
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });

    const activities = await CRMActivity.find({ relatedToType: "contact", relatedToId: contact._id })
      .sort({ createdAt: -1 }).limit(30).populate("performedBy", "name").lean();

    res.json({ success: true, data: { ...contact, activities } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch contact" });
  }
};

export const createContact = async (req, res) => {
  try {
    const { firstName, email } = req.body;
    if (!firstName) return res.status(400).json({ success: false, message: "First name is required" });

    if (email) {
      const exists = await CRMContact.exists({ email: email.toLowerCase().trim(), isDeleted: false });
      if (exists) return res.status(409).json({ success: false, message: "Contact with this email already exists" });
    }

    const contact = await CRMContact.create({ ...req.body, createdBy: req.admin._id });
    await logActivity(contact._id, "created", "Contact created", `${firstName} added to CRM`, req.admin._id);

    res.status(201).json({ success: true, data: contact, message: "Contact created" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to create contact" });
  }
};

export const updateContact = async (req, res) => {
  try {
    const contact = await CRMContact.findOne({ _id: req.params.id, isDeleted: false });
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });

    const allowed = ["firstName", "lastName", "email", "phone", "whatsApp", "company", "designation",
      "department", "linkedIn", "twitter", "website", "country", "state", "city", "timezone",
      "isDecisionMaker", "isPrimaryContact", "tags", "notes"];
    allowed.forEach((f) => { if (req.body[f] !== undefined) contact[f] = req.body[f]; });

    await contact.save();
    res.json({ success: true, data: contact, message: "Contact updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update contact" });
  }
};

export const deleteContact = async (req, res) => {
  try {
    const contact = await CRMContact.findOne({ _id: req.params.id, isDeleted: false });
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
    contact.isDeleted = true;
    await contact.save();
    res.json({ success: true, message: "Contact deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete contact" });
  }
};

export const addContactNote = async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ success: false, message: "Note body required" });
    const contact = await CRMContact.findOne({ _id: req.params.id, isDeleted: false });
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
    contact.notes.push({ body: body.trim(), createdBy: req.admin._id });
    await contact.save();
    await logActivity(contact._id, "note", "Note added", body.trim(), req.admin._id);
    res.json({ success: true, data: contact.notes[contact.notes.length - 1] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to add note" });
  }
};

export const getContactActivities = async (req, res) => {
  try {
    const activities = await CRMActivity.find({ relatedToType: "contact", relatedToId: req.params.id })
      .sort({ createdAt: -1 }).limit(50).populate("performedBy", "name email").lean();
    res.json({ success: true, data: activities });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch activities" });
  }
};
