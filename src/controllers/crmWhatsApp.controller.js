import CRMLead from "../models/crm/crmLead.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMTag from "../models/crm/crmTag.model.js";
import WhatsAppMessage from "../models/whatsappMessage.model.js";
import { createdByFilter, isOwnerScoped, isValidId, leadScope, sendCrmError } from "../utils/crmQuery.js";
import { isWhatsAppConfigured, sendTemplate, sendText, toWhatsAppId } from "../services/whatsapp.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Each name must exist as an approved template on the WhatsApp Business account, with this body
// and variables in this order ({{1}} = first name, {{2}} = course). Stage → template hints live in the CRM UI.
export const WA_TEMPLATES = {
  initial_followup: {
    label: "Initial follow-up",
    body: "Hi {{1}}! This is the Technohana team. We noticed your interest in {{2}}. Is this a good time to chat?",
  },
  quote_followup: {
    label: "Quote follow-up",
    body: "Hi {{1}}, just following up on the {{2}} quote we shared. Do you have any questions? We're happy to customise the program for your team.",
  },
  training_details: {
    label: "Training details",
    body: "Hi {{1}}, here are the details for your upcoming {{2}} with Technohana. Our trainer will connect with you before the session starts.",
  },
  win_confirmation: {
    label: "Win confirmation",
    body: "Congratulations, {{1}}! Your enrollment in {{2}} is confirmed. Our team will reach out with onboarding details shortly. Welcome to Technohana!",
  },
};

const fillTemplate = (body, params) => body.replace(/\{\{(\d)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");

const fail = (res, err, fallback) =>
  err.status ? res.status(err.status).json({ success: false, message: err.message }) : sendCrmError(res, err, fallback);

// The do-not-contact tag is a hard stop for every outbound channel.
async function isDoNotContact(record) {
  if (!record.tags?.length) return false;
  const tag = await CRMTag.findOne({ name: "do-not-contact" }).select("_id").lean();
  return !!tag && record.tags.some((t) => String(t) === String(tag._id));
}

async function loadRecord(req, type) {
  const id = req.params.id;
  if (type === "lead") {
    const scope = leadScope(req, id);
    return scope && CRMLead.findOne(scope).select("name phone whatsApp country interest tags").lean();
  }
  const record = isValidId(String(id)) && await CRMContact.findOne({ _id: id, isDeleted: false, ...createdByFilter(req) })
    .select("firstName lastName phone whatsApp country tags").lean();
  if (record) record.name = [record.firstName, record.lastName].filter(Boolean).join(" ");
  return record;
}

const recordWaId = (r) => toWhatsAppId(r.whatsApp || r.phone, r.country);

async function windowState(waId) {
  const [lastInbound, optedOut] = await Promise.all([
    WhatsAppMessage.findOne({ phone: waId, direction: "in" }).sort({ createdAt: -1 }).select("createdAt").lean(),
    WhatsAppMessage.exists({ phone: waId, direction: "in", type: "opt_out" }),
  ]);
  const closesAt = lastInbound ? new Date(lastInbound.createdAt.getTime() + WINDOW_MS) : null;
  return { windowOpen: !!closesAt && closesAt > new Date(), windowClosesAt: closesAt, optedOut: !!optedOut };
}

export const getWhatsAppTemplates = (_req, res) => {
  res.json({
    success: true,
    data: {
      configured: isWhatsAppConfigured(),
      templates: Object.entries(WA_TEMPLATES).map(([key, t]) => ({ key, ...t })),
    },
  });
};

const threadHandler = (type) => async (req, res) => {
  try {
    const record = await loadRecord(req, type);
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    const waId = recordWaId(record);
    if (!waId) return res.json({ success: true, data: { configured: isWhatsAppConfigured(), phone: null, messages: [] } });

    const [messages, state] = await Promise.all([
      WhatsAppMessage.find({ phone: waId })
        .sort({ createdAt: -1 }).limit(200)
        .select("direction type body templateName status error createdAt sentBy")
        .populate("sentBy", "name")
        .lean(),
      windowState(waId),
    ]);
    res.json({
      success: true,
      data: {
        configured: isWhatsAppConfigured(),
        phone: `+${waId}`,
        blocked: await isDoNotContact(record),
        ...state,
        messages: messages.reverse(),
      },
    });
  } catch (err) {
    fail(res, err, "Could not load the WhatsApp thread");
  }
};

const sendHandler = (type) => async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const tplKey = req.body?.template;
    const tpl = tplKey ? WA_TEMPLATES[tplKey] : null;
    if (tplKey && !tpl) return res.status(400).json({ success: false, message: "Unknown template" });
    if (!tpl && (!text || text.length > 1000)) {
      return res.status(400).json({ success: false, message: "Message must be 1–1000 characters" });
    }

    const record = await loadRecord(req, type);
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });
    if (!record.whatsApp && !record.phone) return res.status(400).json({ success: false, message: "This record has no phone number" });
    if (await isDoNotContact(record)) {
      return res.status(409).json({ success: false, message: "This record is tagged do-not-contact — messaging is blocked." });
    }

    const link = { relatedToType: type, relatedToId: record._id, sentBy: req.admin._id };
    const phone = record.whatsApp || record.phone;
    let msg;
    if (tpl) {
      const first = (record.name || "").trim().split(/\s+/)[0] || "there";
      const params = [first, record.interest || "our AI training programs"];
      msg = await sendTemplate({
        phone, country: record.country, name: tplKey, ...link,
        components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p).slice(0, 100) })) }],
        body: fillTemplate(tpl.body, params),
      });
    } else {
      msg = await sendText({ phone, country: record.country, body: text, ...link });
    }

    await CRMActivity.create({
      type: "whatsapp",
      title: tpl ? `WhatsApp template sent: ${tpl.label}` : "WhatsApp sent",
      body: msg.body,
      relatedToType: type, relatedToId: record._id, performedBy: req.admin._id,
      metadata: { direction: "out", waMessageId: msg.waMessageId, template: tplKey },
    });
    res.status(201).json({ success: true, data: msg });
  } catch (err) {
    fail(res, err, "Could not send the WhatsApp message");
  }
};

export const getLeadWhatsApp = threadHandler("lead");
export const getContactWhatsApp = threadHandler("contact");
export const sendLeadWhatsApp = sendHandler("lead");
export const sendContactWhatsApp = sendHandler("contact");

// Conversations the caller may see, newest first. A rep only sees chats with their own leads.
export const getWhatsAppInbox = async (req, res) => {
  try {
    const mine = !isOwnerScoped(req) ? null : await CRMLead.find({
      assignedTo: req.admin._id, isDeleted: false, phoneNormalized: { $exists: true, $ne: null },
    }).select("name status phoneNormalized").lean();

    const match = mine ? { phone: { $in: mine.map((l) => l.phoneNormalized.replace(/^\+/, "")) } } : {};
    const groups = await WhatsAppMessage.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$phone", last: { $first: "$$ROOT" } } },
      { $sort: { "last.createdAt": -1 } },
      { $limit: 100 },
    ]);

    const leads = mine || await CRMLead.find({
      isDeleted: false, phoneNormalized: { $in: groups.map((g) => `+${g._id}`) },
    }).select("name status phoneNormalized").lean();
    const byPhone = new Map(leads.map((l) => [l.phoneNormalized.replace(/^\+/, ""), l]));

    res.json({
      success: true,
      data: groups.map((g) => {
        const lead = byPhone.get(g._id);
        return {
          phone: `+${g._id}`,
          leadId: lead?._id || null,
          name: lead?.name || null,
          status: lead?.status || null,
          lastMessage: g.last.body || `(${g.last.type})`,
          lastDirection: g.last.direction,
          lastAt: g.last.createdAt,
          awaitingReply: g.last.direction === "in" && g.last.type !== "opt_out",
        };
      }),
    });
  } catch (err) {
    fail(res, err, "Could not load the WhatsApp inbox");
  }
};

// Open leads of one rep whose latest WhatsApp message is from the lead and still unanswered.
export async function awaitingWhatsAppReplies(adminId) {
  const leads = await CRMLead.find({
    assignedTo: adminId, isDeleted: false, status: { $nin: ["won", "lost", "junk"] }, phoneNormalized: { $exists: true, $ne: null },
  }).select("name phoneNormalized").lean();
  if (!leads.length) return [];

  const groups = await WhatsAppMessage.aggregate([
    { $match: { phone: { $in: leads.map((l) => l.phoneNormalized.replace(/^\+/, "")) } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$phone", last: { $first: "$$ROOT" } } },
    { $match: { "last.direction": "in", "last.type": { $ne: "opt_out" } } },
    { $sort: { "last.createdAt": -1 } },
  ]);
  const byPhone = new Map(leads.map((l) => [l.phoneNormalized.replace(/^\+/, ""), l]));
  return groups.map((g) => ({ _id: byPhone.get(g._id)._id, name: byPhone.get(g._id).name, lastAt: g.last.createdAt }));
}
