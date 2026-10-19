// Meta Conversions API: server-side copies of the browser pixel's Lead and Purchase events.
// The same event_id as the browser event lets Meta de-duplicate them. Off unless
// META_CAPI_ENABLED=true; never throws, because a tracking failure must not break a form or payment.
import crypto from "crypto";
import { normalizePhone } from "../utils/phone.js";

const DEFAULT_PIXEL_ID = "1304214271144571";
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

const accessToken = () => process.env.META_CAPI_ACCESS_TOKEN || process.env.META_ADS_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
export const isMetaCapiEnabled = () => process.env.META_CAPI_ENABLED === "true" && !!accessToken();

const hashed = (value, normalise = (s) => s.trim().toLowerCase()) => {
  if (value == null || value === "") return undefined;
  const v = normalise(String(value));
  return v ? sha256(v) : undefined;
};

const clientIp = (req) => String(req.headers?.["x-forwarded-for"] || req.ip || "").split(",")[0].trim() || undefined;

// Browser cookies/URL sent by the site as `meta` in the request body.
const cleanMeta = (meta) => (meta && typeof meta === "object" ? meta : {});

export function buildMetaEvent({ name, eventId, req, meta, user = {}, custom = {}, now = Date.now() }) {
  const m = cleanMeta(meta);
  const [firstName, ...rest] = String(user.name || "").trim().split(/\s+/);
  const phone = normalizePhone(user.phone, user.country);

  const userData = {
    em: hashed(user.email) && [hashed(user.email)],
    ph: phone && [sha256(phone.replace(/\D/g, ""))],
    fn: hashed(firstName) && [hashed(firstName)],
    ln: hashed(rest.join(" ")) && [hashed(rest.join(" "))],
    client_ip_address: clientIp(req),
    client_user_agent: req.get?.("user-agent") || undefined,
    fbp: typeof m.fbp === "string" ? m.fbp : undefined,
    fbc: typeof m.fbc === "string" ? m.fbc : undefined,
  };
  Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

  return {
    event_name: name,
    event_time: Math.floor(now / 1000),
    event_id: String(eventId || m.eventId || ""),
    action_source: "website",
    event_source_url: typeof m.url === "string" ? m.url : process.env.FRONTEND_URL,
    user_data: userData,
    custom_data: custom,
  };
}

/** Sends one event. Resolves { sent, skipped?, error? } and never throws. */
export async function sendMetaEvent(args) {
  if (!isMetaCapiEnabled()) return { sent: false, skipped: "disabled" };
  const event = buildMetaEvent(args);
  if (!event.event_id) return { sent: false, skipped: "no event id (cannot de-duplicate)" };

  try {
    const token = accessToken();
    const proof = process.env.META_APP_SECRET && crypto.createHmac("sha256", process.env.META_APP_SECRET).update(token).digest("hex");
    const qs = new URLSearchParams({ access_token: token, ...(proof && { appsecret_proof: proof }) });
    const res = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v21.0"}/${process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID}/events?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [event],
        ...(process.env.META_CAPI_TEST_EVENT_CODE && { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || `Conversions API responded ${res.status}`);
    return { sent: true, eventsReceived: body.events_received };
  } catch (err) {
    console.error(`[meta-capi] ${args.name} ${event.event_id} failed:`, err.message);
    return { sent: false, error: err.message };
  }
}

// Mirrors the browser "Lead" event fired after a successful form submission.
export const sendMetaLead = ({ req, user, contentName, contentCategory }) =>
  sendMetaEvent({
    name: "Lead",
    req,
    meta: req.body?.meta,
    user,
    custom: { ...(contentName && { content_name: contentName }), ...(contentCategory && { content_category: contentCategory }) },
  });

// Mirrors the browser "Purchase" event; eventId is the order id (single) or primary order id (cart).
export const sendMetaPurchase = ({ req, eventId, user, valueMinor, currency, contentIds, numItems }) =>
  sendMetaEvent({
    name: "Purchase",
    eventId,
    req,
    meta: req.body?.meta,
    user,
    custom: {
      value: Number(valueMinor) / 100,
      currency: String(currency || "").toUpperCase(),
      content_type: "product",
      content_ids: contentIds,
      num_items: numItems,
    },
  });
