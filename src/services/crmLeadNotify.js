import * as webpush from "web-push";
import CrmUser from "../models/crmUser.model.js";
import CrmNotification from "../models/crm/crmNotification.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { escapeHtml } from "../utils/emailTemplate.js";
import { shell, CRM_URL } from "./crmReminders.js";

export const isPushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:sales@technohana.in", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  vapidReady = true;
}

const label = (key) => String(key || "other").replace(/_/g, " ");

const waitedLabel = (min) => (min >= 120 ? `${Math.round(min / 60)} hours` : `${min} minutes`);

function compose(list, reason, waitedMinutes) {
  const first = list[0];
  if (list.length > 1) {
    return {
      title: `${list.length} leads assigned to you`,
      body: `${list.slice(0, 3).map((l) => l.name).join(", ")}${list.length > 3 ? "…" : ""}`,
      url: `${CRM_URL()}/leads`,
      lead: null,
      rows: [],
    };
  }
  const title = {
    new: `New lead: ${first.name}`,
    repeat: `${first.name} submitted again`,
    reassigned: `Lead assigned to you: ${first.name}`,
    untouched: `No contact yet: ${first.name}`,
  }[reason] || `New lead: ${first.name}`;
  const rows = [
    ["Contact", [first.phone, first.email].filter(Boolean).join(" · ")],
    ["Interest", first.interest],
    ["Company", first.company],
    ["Source", first.source && label(first.source)],
    ["Priority", first.priority],
  ].filter(([, v]) => v);
  const waiting = reason === "untouched" && waitedMinutes ? `Waiting ${waitedLabel(waitedMinutes)}` : null;
  return {
    title,
    body: [waiting, first.interest, first.company, first.phone].filter(Boolean).join(" · ").slice(0, 200),
    url: `${CRM_URL()}/leads/${first._id}`,
    lead: first._id,
    rows,
  };
}

async function sendEmailAlert(user, msg, reason) {
  const intro = {
    repeat: "A lead you own just submitted another enquiry.",
    untouched: "This paid-ad lead has no call, email or WhatsApp logged yet. Ad leads cool quickly, so please reach out now.",
  }[reason] || "A lead was just assigned to you — the sooner you reach out, the better the chance of conversion.";
  const details = msg.rows.length
    ? `<table style="border-collapse:collapse;margin:12px 0">${msg.rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:4px 0"><strong>${escapeHtml(String(v))}</strong></td></tr>`).join("")}</table>`
    : `<p style="color:#475569">${escapeHtml(msg.body)}</p>`;
  const cc = reason === "new" ? (process.env.CRM_NEW_LEAD_CC || "").split(",").map((e) => e.trim()).filter(Boolean) : [];
  const result = await sendEmail({
    from: fromAddresses.sales,
    to: user.email,
    ...(cc.length ? { cc } : {}),
    subject: msg.title,
    html: shell(escapeHtml(msg.title), `<p>Hi ${escapeHtml(user.name)},</p><p>${intro}</p>${details}`, { href: msg.url, cta: msg.lead ? "Open the lead" : "Open my leads" }),
  });
  if (result?.error) throw new Error(result.error.message || "send failed");
}

// "high" urgency wakes an Android phone in Doze straight away; "normal" pushes can be held back for minutes.
async function sendPush(user, msg, tag, urgency) {
  if (!isPushConfigured() || !user.pushSubscriptions?.length) return;
  ensureVapid();
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag });
  await Promise.all(user.pushSubscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 60 * 60, urgency });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await CrmUser.updateOne({ _id: user._id }, { $pull: { pushSubscriptions: { endpoint: sub.endpoint } } });
      } else {
        console.error("[crm-notify] push failed:", err.statusCode || err.message);
      }
    }
  }));
}

// Loaded lazily: whatsapp.js imports crmLeadIntake, which imports this file.
async function sendWhatsAppAlert(user, list) {
  const template = process.env.WHATSAPP_NEW_LEAD_TEMPLATE;
  if (!template || !user.phone) return;
  const { sendStaffTemplate } = await import("./whatsapp.js");
  const first = list[0];
  const text = list.length > 1 ? `${list.length} leads` : first.name;
  const detail = list.length > 1 ? "Open the CRM to see them" : [first.interest, first.phone].filter(Boolean).join(" · ") || "Open the CRM for details";
  await sendStaffTemplate({
    phone: user.phone,
    name: template,
    language: process.env.WHATSAPP_NEW_LEAD_LANG || "en",
    components: [{ type: "body", parameters: [{ type: "text", text }, { type: "text", text: detail.slice(0, 200) }] }],
  });
}

const attempt = async (channel, fn) => {
  try { await fn(); } catch (err) { console.error(`[crm-notify] ${channel} failed:`, err.message); }
};

/**
 * Tells a rep that leads were assigned to them (email, in-app bell, web push, WhatsApp per their prefs).
 * `leads` may be one lead or several (bulk assign → one alert). `reason`: "new" | "repeat" | "reassigned" |
 * "untouched" (a paid-ad lead nobody has contacted; `waitedMinutes` says for how long).
 * Fire-and-forget: never throws and never blocks the action that triggered it.
 */
export function notifyLeadAssigned({ leads, assigneeId, reason = "new", actorId, waitedMinutes }) {
  const list = (Array.isArray(leads) ? leads : [leads]).filter(Boolean);
  if (!assigneeId || !list.length) return;
  if (actorId && String(actorId) === String(assigneeId)) return;

  (async () => {
    const user = await CrmUser.findOne({ _id: assigneeId, active: true })
      .select("name email phone notifyPrefs +pushSubscriptions").lean();
    if (!user) return;

    // A visitor resubmitting must not ping the rep every time: one "submitted again" alert per lead per 6 hours.
    if (reason === "repeat" && list[0]._id && await CrmNotification.exists({
      user: user._id, lead: list[0]._id, createdAt: { $gt: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    })) return;

    const msg = compose(list, reason, waitedMinutes);
    const prefs = user.notifyPrefs || {};

    await attempt("in-app", () => CrmNotification.create({
      user: user._id, lead: msg.lead, title: msg.title, body: msg.body, count: list.length,
    }));
    if (prefs.email !== false && user.email) await attempt("email", () => sendEmailAlert(user, msg, reason));
    if (prefs.push !== false) await attempt("push", () => sendPush(user, msg, `lead-${msg.lead || "bulk"}`, reason === "repeat" ? "normal" : "high"));
    if (prefs.whatsapp === true && reason !== "repeat" && reason !== "untouched") await attempt("whatsapp", () => sendWhatsAppAlert(user, list));
  })().catch((err) => console.error("[crm-notify] failed:", err.message));
}
