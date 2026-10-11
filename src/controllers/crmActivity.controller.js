import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMTag from "../models/crm/crmTag.model.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMCompany from "../models/crm/crmCompany.model.js";
import { parsePaging, attachRelated, isValidId, isOwnerScoped, ownerFilter, canAccessRelated, sendCrmError } from "../utils/crmQuery.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { escapeHtml } from "../utils/emailTemplate.js";

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

// ── Email (sent through Resend) ──────────────────────────────────────────────

const toHtmlParagraphs = (text) => text
  .split(/\r?\n\s*\r?\n/)
  .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\r?\n/g, "<br/>")}</p>`)
  .join("");

const emailLayout = ({ body, repName }) => `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;max-width:600px">
  ${toHtmlParagraphs(body)}
  <p style="margin:24px 0 0;color:#64748b;font-size:12px">${escapeHtml(repName)} · Technohana</p>
</div>`;

// POST /email/send — emails a lead or contact from the CRM sales address (replies
// go to the rep) and logs it on the record with the Resend id for delivery tracking.
export const sendCrmEmail = async (req, res) => {
  try {
    const { leadId, contactId, subject, body } = req.body;
    if (typeof subject !== "string" || !subject.trim() || subject.length > 200) {
      return res.status(400).json({ success: false, message: "Add a subject (up to 200 characters)" });
    }
    if (typeof body !== "string" || !body.trim() || body.length > 20000) {
      return res.status(400).json({ success: false, message: "Write the email body" });
    }

    let record;
    let relatedToType;
    if (leadId) {
      relatedToType = "lead";
      record = await CRMLead.findOne({ _id: isValidId(String(leadId)) ? leadId : null, isDeleted: false, ...ownerFilter(req) })
        .select("name email").lean();
    } else if (contactId) {
      relatedToType = "contact";
      record = isValidId(String(contactId)) && await CRMContact.findOne({ _id: contactId, isDeleted: false })
        .select("firstName lastName email").lean();
      if (record) record.name = [record.firstName, record.lastName].filter(Boolean).join(" ");
    }
    if (!record) return res.status(404).json({ success: false, message: "Recipient not found" });
    if (!record.email) return res.status(400).json({ success: false, message: "This record has no email address" });

    // Don't keep mailing an address that bounced or complained before.
    const suppressed = await CRMActivity.exists({
      type: "email", "metadata.to": record.email, "metadata.status": { $in: ["bounced", "complained"] },
    });
    if (suppressed) {
      return res.status(409).json({ success: false, message: `${record.email} bounced or marked a previous email as spam — not sending.` });
    }

    // Log first so the Resend tag can point back at this activity.
    const activity = await CRMActivity.create({
      type: "email",
      title: subject.trim(),
      body: body.trim(),
      relatedToType,
      relatedToId: record._id,
      performedBy: req.admin._id,
      metadata: { to: record.email, subject: subject.trim(), status: "sending", events: [] },
    });

    let result;
    try {
      result = await sendEmail({
        from: process.env.CRM_FROM_EMAIL || fromAddresses.sales,
        to: record.email,
        replyTo: req.admin.email,
        subject: subject.trim(),
        html: emailLayout({ body: body.trim(), repName: req.admin.name || "Technohana Sales" }),
        text: `${body.trim()}\n\n${req.admin.name || "Technohana Sales"} · Technohana`,
        tags: [{ name: "source", value: "crm" }, { name: "crm_activity", value: String(activity._id) }],
      });
      if (result?.error) throw new Error(result.error.message || "Resend rejected the email");
    } catch (err) {
      await CRMActivity.updateOne({ _id: activity._id }, { "metadata.status": "failed", "metadata.error": err.message });
      console.error("CRM email send failed:", err.message);
      return res.status(502).json({ success: false, message: "The email couldn't be sent. It's logged as failed — try again shortly." });
    }

    await CRMActivity.updateOne({ _id: activity._id }, {
      "metadata.status": "sent", "metadata.resendId": result?.data?.id, "metadata.sentAt": new Date(),
    });
    res.status(201).json({ success: true, data: { activityId: activity._id, resendId: result?.data?.id }, message: `Email sent to ${record.email}` });
  } catch (err) {
    sendCrmError(res, err, "Failed to send email");
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
