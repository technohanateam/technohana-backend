import CRMLead from "../models/crm/crmLead.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMTag from "../models/crm/crmTag.model.js";
import WhatsAppMessage from "../models/whatsappMessage.model.js";
import { createdByFilter, isOwnerScoped, isValidId, leadScope, ownerFilter, sendCrmError } from "../utils/crmQuery.js";
import { isInServiceWindow, isWhatsAppConfigured, sendTemplate, sendText, toWhatsAppId } from "../services/whatsapp.js";
import { createCrmPaymentLink } from "../services/instalments.js";

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

// Template parameters can't hold newlines, tabs or runs of spaces (Meta error 132018).
const cleanParam = (value, fallback) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 100) || fallback;

// A lead may be reached on `phone` or on a separate WhatsApp number — match either.
const waIdsOf = (lead) => [lead.phoneNormalized, lead.whatsAppNormalized].filter(Boolean).map((p) => p.replace(/^\+/, ""));
const leadsByWaIds = (waIds) => {
  const plus = waIds.map((id) => `+${id}`);
  return { $or: [{ phoneNormalized: { $in: plus } }, { whatsAppNormalized: { $in: plus } }] };
};
function indexLeadsByWaId(leads) {
  const index = new Map();
  for (const lead of leads) {
    for (const id of waIdsOf(lead)) index.set(id, [...(index.get(id) || []), lead]);
  }
  return index;
}
const LEAD_FIELDS = "name status phoneNormalized whatsAppNormalized updatedAt";

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

// Messages are keyed by phone, so two records can share a number. A rep only gets messages that are
// unlinked, belong to this record, or belong to a lead they may see — never another rep's chat.
async function threadFilter(req, type, record, waId) {
  if (!isOwnerScoped(req)) return { phone: waId };
  const visible = await CRMLead.distinct("_id", { isDeleted: false, ...ownerFilter(req), ...leadsByWaIds([waId]) });
  return {
    phone: waId,
    $or: [
      { relatedToId: null },
      { relatedToType: type, relatedToId: record._id },
      { relatedToType: "lead", relatedToId: { $in: visible } },
    ],
  };
}

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
    if (!waId) {
      return res.json({
        success: true,
        data: {
          configured: isWhatsAppConfigured(), phone: null, invalidPhone: true, blocked: false,
          windowOpen: false, windowClosesAt: null, optedOut: false, messages: [],
        },
      });
    }

    const [messages, state] = await Promise.all([
      WhatsAppMessage.find(await threadFilter(req, type, record, waId))
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
      const params = [
        cleanParam((record.name || "").trim().split(/\s+/)[0], "there"),
        cleanParam(record.interest, "our AI training programs"),
      ];
      msg = await sendTemplate({
        phone, country: record.country, name: tplKey, ...link,
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
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

const PAYMENT_LINK_MAX_INR = 1000000;
// Stages a payment link must not pull a lead back from.
const PAST_PAYMENT_PENDING = ["payment_pending", "won", "enrolled", "lost", "junk"];

// POST /leads/:id/payment-link and /contacts/:id/payment-link  { amount (INR), description }
// Creates a Razorpay payment link and sends it on WhatsApp: as plain text inside the 24h reply window, otherwise
// through the approved template named in WHATSAPP_PAYMENT_LINK_TEMPLATE (body vars: first name, description, link).
const paymentLinkHandler = (type) => async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const description = cleanParam(req.body?.description, "");
    if (!Number.isFinite(amount) || amount < 1 || amount > PAYMENT_LINK_MAX_INR) {
      return res.status(400).json({ success: false, message: `Amount must be between 1 and ${PAYMENT_LINK_MAX_INR} INR` });
    }
    if (!description) return res.status(400).json({ success: false, message: "Add what the payment is for" });

    const record = await loadRecord(req, type);
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });
    if (!record.whatsApp && !record.phone) return res.status(400).json({ success: false, message: "This record has no phone number" });
    if (await isDoNotContact(record)) {
      return res.status(409).json({ success: false, message: "This record is tagged do-not-contact — messaging is blocked." });
    }

    const waId = recordWaId(record);
    const templateName = process.env.WHATSAPP_PAYMENT_LINK_TEMPLATE;
    const inWindow = !!waId && await isInServiceWindow(waId);
    if (!inWindow && !templateName) {
      return res.status(409).json({ success: false, message: "Outside the 24h reply window and no payment-link template is set up. Ask the contact to reply first." });
    }

    const phone = record.whatsApp || record.phone;
    const first = cleanParam((record.name || "").trim().split(/\s+/)[0], "there");
    const amountMinor = Math.round(amount * 100);
    const link = await createCrmPaymentLink({ recordType: type, recordId: record._id, name: record.name, phone: waId && `+${waId}`, amountMinor, description });

    const body = `Hi ${first}, here is your secure payment link for ${description} (INR ${amount.toFixed(2)}): ${link.url}`;
    const waLink = { relatedToType: type, relatedToId: record._id, sentBy: req.admin._id };
    const msg = inWindow
      ? await sendText({ phone, country: record.country, body, ...waLink })
      : await sendTemplate({
        phone, country: record.country, name: templateName, language: process.env.WHATSAPP_PAYMENT_LINK_LANG || "en", ...waLink,
        components: [{ type: "body", parameters: [first, description, link.url].map((text) => ({ type: "text", text })) }],
        body,
      });

    if (type === "lead") {
      await CRMLead.updateOne({ _id: record._id, status: { $nin: PAST_PAYMENT_PENDING } }, { $set: { status: "payment_pending" } });
    }
    await CRMActivity.create({
      type: "whatsapp",
      title: "Payment link sent",
      body: `INR ${amount.toFixed(2)} for ${description}`,
      relatedToType: type, relatedToId: record._id, performedBy: req.admin._id,
      metadata: { direction: "out", waMessageId: msg.waMessageId, paymentLinkId: link.id, amountMinor, linkExpiresAt: link.expiresAt },
    });
    res.status(201).json({ success: true, data: { message: msg, url: link.url, expiresAt: link.expiresAt } });
  } catch (err) {
    fail(res, err, "Could not send the payment link");
  }
};

export const getLeadWhatsApp = threadHandler("lead");
export const getContactWhatsApp = threadHandler("contact");
export const sendLeadWhatsApp = sendHandler("lead");
export const sendContactWhatsApp = sendHandler("contact");
export const sendLeadPaymentLink = paymentLinkHandler("lead");
export const sendContactPaymentLink = paymentLinkHandler("contact");

// Conversations the caller may see, newest first. A rep sees chats with leads in their own scope (including their pool).
export const getWhatsAppInbox = async (req, res) => {
  try {
    let leads = null;
    if (isOwnerScoped(req)) {
      leads = await CRMLead.find({
        isDeleted: false, ...ownerFilter(req),
        $or: [{ phoneNormalized: { $ne: null } }, { whatsAppNormalized: { $ne: null } }],
      }).sort({ updatedAt: -1 }).limit(2000).select(LEAD_FIELDS).lean();
    }

    const match = leads ? { phone: { $in: [...new Set(leads.flatMap(waIdsOf))] } } : {};
    const groups = await WhatsAppMessage.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$phone", last: { $first: "$$ROOT" } } },
      { $sort: { "last.createdAt": -1 } },
      { $limit: 100 },
    ]);

    leads ||= await CRMLead.find({ isDeleted: false, ...leadsByWaIds(groups.map((g) => g._id)) })
      .sort({ updatedAt: -1 }).select(LEAD_FIELDS).lean();
    const index = indexLeadsByWaId(leads);

    res.json({
      success: true,
      data: groups.map((g) => {
        const lead = index.get(g._id)?.[0];
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

// Reps (and their pool) see replies on their leads; admins only on leads assigned to themselves.
export const waNotifyScope = (req) => (isOwnerScoped(req) ? ownerFilter(req) : { assignedTo: req.admin._id });

// Open leads in `leadFilter` whose latest WhatsApp message (last 30 days) is from the lead and unanswered.
// Starts from the messages, so the cost doesn't grow with how many leads someone owns.
export async function awaitingWhatsAppReplies(leadFilter) {
  const groups = await WhatsAppMessage.aggregate([
    { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$phone", last: { $first: "$$ROOT" } } },
    { $match: { "last.direction": "in", "last.type": { $ne: "opt_out" } } },
    { $sort: { "last.createdAt": -1 } },
    { $limit: 300 },
  ]);
  if (!groups.length) return [];

  const leads = await CRMLead.find({
    ...leadFilter, isDeleted: false, status: { $nin: ["won", "lost", "junk"] }, ...leadsByWaIds(groups.map((g) => g._id)),
  }).sort({ updatedAt: -1 }).limit(300).select(LEAD_FIELDS).lean();
  const index = indexLeadsByWaId(leads);

  const seen = new Set();
  return groups.flatMap((g) => (index.get(g._id) || [])
    .filter((l) => !seen.has(String(l._id)) && seen.add(String(l._id)))
    .map((l) => ({ _id: l._id, name: l.name, lastAt: g.last.createdAt })));
}
