import SeoContact from "../models/seoContact.model.js";
import SeoCampaign from "../models/seoCampaign.model.js";
import { buildMultiFieldRegexQuery } from "../utils/escapeRegex.js";

const paginate = (query) => {
  const pageNum = Math.max(1, Number(query.page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

// Empty strings from HTML date inputs fail Mongoose's Date cast — treat them as "not set".
const sanitizeDates = (body, dateFields) => {
  const clean = { ...body };
  for (const field of dateFields) {
    if (clean[field] === "") clean[field] = undefined;
  }
  return clean;
};

// ---- Contacts ----
export const getContacts = async (req, res) => {
  try {
    const { search, status } = req.query;
    const { pageNum, limitNum, skip } = paginate(req.query);
    const filter = {};
    const regexQuery = buildMultiFieldRegexQuery(search, ["contactName", "company", "website", "email"]);
    if (regexQuery) Object.assign(filter, regexQuery);
    if (status) filter.status = status;

    const total = await SeoContact.countDocuments(filter);
    const data = await SeoContact.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean();
    return res.json({ success: true, data, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) || 1 } });
  } catch (error) {
    console.error("Error fetching SEO contacts:", error);
    return res.status(500).json({ success: false, message: "Error fetching SEO contacts" });
  }
};

export const createContact = async (req, res) => {
  try {
    const body = sanitizeDates(req.body, ["lastContact", "nextFollowUp"]);
    const contact = await SeoContact.create({ ...body, status: body.status || "new" });
    return res.status(201).json({ success: true, message: "Contact created", data: contact });
  } catch (error) {
    console.error("Error creating SEO contact:", error);
    return res.status(500).json({ success: false, message: "Error creating SEO contact" });
  }
};

const CONTACT_EDITABLE_FIELDS = [
  "contactName",
  "company",
  "website",
  "email",
  "role",
  "opportunityType",
  "status",
  "lastContact",
  "nextFollowUp",
  "owner",
  "notes",
];

export const updateContact = async (req, res) => {
  try {
    const contact = await SeoContact.findById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
    const body = sanitizeDates(req.body, ["lastContact", "nextFollowUp"]);
    for (const field of CONTACT_EDITABLE_FIELDS) {
      if (body[field] !== undefined) contact[field] = body[field];
    }
    await contact.save();
    return res.json({ success: true, message: "Contact updated", data: contact });
  } catch (error) {
    console.error("Error updating SEO contact:", error);
    return res.status(500).json({ success: false, message: "Error updating SEO contact" });
  }
};

// Archive rather than hard-delete, per "Create / Edit / Archive" spec
export const archiveContact = async (req, res) => {
  try {
    const contact = await SeoContact.findById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
    contact.status = "archived";
    await contact.save();
    return res.json({ success: true, message: "Contact archived", data: contact });
  } catch (error) {
    console.error("Error archiving SEO contact:", error);
    return res.status(500).json({ success: false, message: "Error archiving SEO contact" });
  }
};

export const addFollowUp = async (req, res) => {
  try {
    const contact = await SeoContact.findById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
    contact.followUps.push({
      followUpNumber: contact.followUps.length + 1,
      scheduledDate: req.body.scheduledDate || undefined,
      completed: req.body.completed || false,
      notes: req.body.notes,
    });
    await contact.save();
    return res.json({ success: true, message: "Follow-up added", data: contact });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Error adding follow-up:", error);
    return res.status(500).json({ success: false, message: "Error adding follow-up" });
  }
};

export const addResponse = async (req, res) => {
  try {
    const contact = await SeoContact.findById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
    contact.responses.push({
      response: req.body.response,
      decision: req.body.decision,
      liveLink: req.body.liveLink,
      notes: req.body.notes,
    });
    await contact.save();
    return res.json({ success: true, message: "Response added", data: contact });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Error adding response:", error);
    return res.status(500).json({ success: false, message: "Error adding response" });
  }
};

// ---- Campaigns ----
export const getCampaigns = async (req, res) => {
  try {
    const { search, status } = req.query;
    const { pageNum, limitNum, skip } = paginate(req.query);
    const filter = {};
    const regexQuery = buildMultiFieldRegexQuery(search, ["campaign", "targetAudience", "objective"]);
    if (regexQuery) Object.assign(filter, regexQuery);
    if (status) filter.status = status;

    const total = await SeoCampaign.countDocuments(filter);
    const data = await SeoCampaign.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean();
    return res.json({ success: true, data, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) || 1 } });
  } catch (error) {
    console.error("Error fetching SEO campaigns:", error);
    return res.status(500).json({ success: false, message: "Error fetching SEO campaigns" });
  }
};

export const createCampaign = async (req, res) => {
  try {
    const campaign = await SeoCampaign.create(sanitizeDates(req.body, ["startDate", "endDate"]));
    return res.status(201).json({ success: true, message: "Campaign created", data: campaign });
  } catch (error) {
    console.error("Error creating SEO campaign:", error);
    return res.status(500).json({ success: false, message: "Error creating SEO campaign" });
  }
};

const CAMPAIGN_EDITABLE_FIELDS = ["campaign", "targetAudience", "startDate", "endDate", "status", "objective", "notes"];

export const updateCampaign = async (req, res) => {
  try {
    const campaign = await SeoCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    const body = sanitizeDates(req.body, ["startDate", "endDate"]);
    for (const field of CAMPAIGN_EDITABLE_FIELDS) {
      if (body[field] !== undefined) campaign[field] = body[field];
    }
    await campaign.save();
    return res.json({ success: true, message: "Campaign updated", data: campaign });
  } catch (error) {
    console.error("Error updating SEO campaign:", error);
    return res.status(500).json({ success: false, message: "Error updating SEO campaign" });
  }
};

export const archiveCampaign = async (req, res) => {
  try {
    const campaign = await SeoCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    campaign.status = "completed";
    await campaign.save();
    return res.json({ success: true, message: "Campaign archived", data: campaign });
  } catch (error) {
    console.error("Error archiving SEO campaign:", error);
    return res.status(500).json({ success: false, message: "Error archiving SEO campaign" });
  }
};

// Import: client parses CSV to a JSON array, matching the existing importLeads convention.
export const importContacts = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 1000) {
      return res.status(400).json({ success: false, message: "rows must be a non-empty array (max 1000)" });
    }
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      const sourceKey = `contact:import:${row.email || row.company || row.contactName}`;
      const existing = await SeoContact.findOne({ sourceKey });
      if (existing) {
        skipped++;
        continue;
      }
      await SeoContact.create({ ...row, sourceKey, status: row.status || "new" });
      imported++;
    }
    return res.json({ success: true, message: "Import complete", data: { imported, skipped } });
  } catch (error) {
    console.error("Error importing SEO contacts:", error);
    return res.status(500).json({ success: false, message: "Error importing SEO contacts" });
  }
};
