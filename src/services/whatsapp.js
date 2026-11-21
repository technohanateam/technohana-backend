import WhatsAppMessage from "../models/whatsappMessage.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import { normalizePhone } from "../utils/phone.js";
import { findDuplicateLead, upsertCrmLead } from "./crmLeadIntake.js";
import { cancelOutreach } from "./crmOutreach.js";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const OPT_OUT_WORDS = new Set(["stop", "unsubscribe", "cancel", "optout", "opt out"]);

// Cloud API wants digits only (no "+").
export const toWhatsAppId = (phone, country) => normalizePhone(phone, country)?.replace(/^\+/, "");

export const isWhatsAppConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

async function graphPost(body) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `WhatsApp API ${res.status}`);
    err.code = json?.error?.code;
    err.status = 502;
    throw err;
  }
  return json;
}

const fail = (message, status) => Object.assign(new Error(message), { status });

const hasOptedOut = (waId) => WhatsAppMessage.exists({ phone: waId, direction: "in", type: "opt_out" });

// Free-form text is only allowed within 24h of the contact's last inbound message.
export async function isInServiceWindow(waId) {
  const last = await WhatsAppMessage.findOne({ phone: waId, direction: "in" }).sort({ createdAt: -1 }).select("createdAt").lean();
  return !!last && Date.now() - last.createdAt.getTime() < SERVICE_WINDOW_MS;
}

async function send({ phone, country, payload, record }) {
  if (!isWhatsAppConfigured()) throw fail("WhatsApp is not configured", 503);
  const waId = toWhatsAppId(phone, country);
  if (!waId) throw fail("Invalid phone number", 400);
  if (await hasOptedOut(waId)) throw fail("Recipient has opted out of WhatsApp messages", 409);

  const msg = await WhatsAppMessage.create({ direction: "out", phone: waId, status: "queued", ...record });
  try {
    const json = await graphPost({ to: waId, ...payload });
    msg.waMessageId = json.messages?.[0]?.id;
    msg.status = "sent";
    msg.statusAt = { sent: new Date() };
  } catch (err) {
    msg.status = "failed";
    msg.error = err.message;
    msg.statusAt = { failed: new Date() };
    await msg.save();
    throw err;
  }
  await msg.save();
  return msg;
}

// components: Cloud API template components, e.g. [{ type: "body", parameters: [{ type: "text", text: "Asha" }] }]
export const sendTemplate = ({ phone, country, name, language = "en", components = [], ...link }) =>
  send({
    phone, country,
    payload: { type: "template", template: { name, language: { code: language }, components } },
    record: { type: "template", templateName: name, ...link },
  });

// Approved Authentication template with a copy-code button; the code goes in both the body and the button.
export const sendLoginCode = ({ phone, code }) =>
  sendTemplate({
    phone,
    name: process.env.WHATSAPP_OTP_TEMPLATE,
    language: process.env.WHATSAPP_OTP_LANG || "en",
    components: [
      { type: "body", parameters: [{ type: "text", text: code }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
    ],
  });

export async function sendText({ phone, country, body, ...link }) {
  const waId = toWhatsAppId(phone, country);
  if (!waId || !(await isInServiceWindow(waId))) throw fail("Outside the 24h reply window — send an approved template instead", 409);
  return send({ phone, country, payload: { type: "text", text: { body } }, record: { type: "text", body, ...link } });
}

// Webhook payload → { messages: [...], statuses: [...] } across all entries.
export function eventsFrom(payload) {
  const out = { messages: [], statuses: [] };
  if (payload?.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const names = new Map((change.value?.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      out.messages.push(...(change.value?.messages || []).map((m) => ({ ...m, profileName: names.get(m.from) })));
      out.statuses.push(...(change.value?.statuses || []));
    }
  }
  return out;
}

const STATUS_RANK = { queued: 0, sent: 1, delivered: 2, read: 3 };

// Statuses can arrive out of order — never move a message backwards.
export async function applyStatus(s) {
  const msg = await WhatsAppMessage.findOne({ waMessageId: s.id });
  if (!msg) return;
  const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
  if (s.status === "failed") {
    msg.status = "failed";
    msg.error = s.errors?.[0]?.title || "Delivery failed";
    msg.set("statusAt.failed", at);
  } else if (STATUS_RANK[s.status] > (STATUS_RANK[msg.status] ?? -1)) {
    msg.status = s.status;
    msg.set(`statusAt.${s.status}`, at);
  } else return;
  await msg.save();
}

// A chat that starts from a Click-to-WhatsApp ad carries `referral`. Those chats become CRM leads;
// any other inbound message only logs an activity if the sender is already a lead (e.g. a reply to outreach).
async function captureWhatsAppLead(m, text) {
  const phone = `+${m.from}`;
  const ad = m.referral;
  if (!ad && !(await findDuplicateLead({ phone }))) return;

  const adLabel = ad?.headline || ad?.source_id || "-";
  const { lead, created } = await upsertCrmLead({
    fields: {
      name: m.profileName || `WhatsApp ${phone}`,
      phone,
      whatsApp: phone,
      source: "meta_ads",
      interest: ad ? `WhatsApp ad enquiry: ${adLabel}` : undefined,
      customFields: ad ? { origin: "whatsapp_ad", adId: ad.source_id, adUrl: ad.source_url, ctwaClid: ad.ctwa_clid } : undefined,
    },
    activityTitle: "Lead captured from WhatsApp ad",
    activityBody: `Ad: ${adLabel} · first message: ${text.slice(0, 200) || `(${m.type})`}`,
    repeatTitle: ad ? "Messaged again from WhatsApp ad" : "Replied on WhatsApp",
    metadata: { waMessageId: m.id },
  });
  // They answered, so the scheduled nudges stop.
  if (!created) await cancelOutreach(lead._id);
}

export async function recordInbound(m) {
  if (await WhatsAppMessage.exists({ waMessageId: m.id })) return; // webhook retries
  const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || "";
  const isOptOut = m.type === "text" && OPT_OUT_WORDS.has(text.trim().toLowerCase());
  const startsConversation = !(await isInServiceWindow(String(m.from)));
  const msg = await WhatsAppMessage.create({
    direction: "in", phone: String(m.from), waMessageId: m.id,
    type: isOptOut ? "opt_out" : m.type, body: text, status: "received",
  });
  if (isOptOut) {
    const lead = await findDuplicateLead({ phone: `+${m.from}` });
    if (lead) await cancelOutreach(lead._id);
    return;
  }
  if (startsConversation) await captureWhatsAppLead(m, text);

  // Tie the message to the lead (possibly just created above) so the rep's thread and timeline show it.
  const lead = await findDuplicateLead({ phone: `+${m.from}` });
  if (!lead) return;
  msg.relatedToType = "lead";
  msg.relatedToId = lead._id;
  await Promise.all([
    msg.save(),
    CRMActivity.create({
      type: "whatsapp", title: "WhatsApp received", body: text || `(${m.type})`,
      relatedToType: "lead", relatedToId: lead._id,
      metadata: { direction: "in", waMessageId: m.id },
    }),
  ]);
}
