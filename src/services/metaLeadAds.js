// Meta (Facebook/Instagram) Lead Ads → CRM leads.
// Webhook → leadgen id → Graph API lead → upsertCrmLead (dedupe + round-robin owner).
import crypto from "crypto";
import CRMActivity from "../models/crm/crmActivity.model.js";
import { upsertCrmLead } from "./crmLeadIntake.js";

const graphBase = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v21.0"}`;
export const LEAD_FIELDS = "created_time,field_data,ad_id,ad_name,adset_name,campaign_name,form_id,platform,is_organic";

// X-Hub-Signature-256 is "sha256=" + HMAC-SHA256(raw request body, app secret).
export function verifyMetaSignature(rawBody, header) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !Buffer.isBuffer(rawBody) || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(given)) return false;
  return crypto.timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

// [{ leadgenId, formId, adId, pageId }] from a Page webhook payload.
export function leadgenEventsFrom(payload) {
  if (payload?.object !== "page" || !Array.isArray(payload.entry)) return [];
  return payload.entry.flatMap((entry) => (entry.changes || [])
    .filter((c) => c.field === "leadgen" && c.value?.leadgen_id)
    .map((c) => ({
      leadgenId: String(c.value.leadgen_id),
      formId: c.value.form_id ? String(c.value.form_id) : undefined,
      adId: c.value.ad_id ? String(c.value.ad_id) : undefined,
      pageId: String(c.value.page_id || entry.id || ""),
    })));
}

const appSecretProof = (token) => crypto.createHmac("sha256", process.env.META_APP_SECRET || "").update(token).digest("hex");

export async function graphGet(path, params = {}) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN is not set");
  const qs = new URLSearchParams({ ...params, access_token: token, appsecret_proof: appSecretProof(token) });
  const res = await fetch(`${graphBase()}/${path}?${qs}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Graph API responded ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export const fetchMetaLead = (leadgenId) => graphGet(encodeURIComponent(leadgenId), { fields: LEAD_FIELDS });

const STANDARD_KEYS = new Set([
  "full_name", "name", "first_name", "last_name", "email", "phone_number", "phone",
  "company_name", "company", "job_title", "city", "state", "province", "country", "zip_code", "post_code",
]);
const humanize = (key) => key.replace(/_/g, " ").replace(/\s+/g, " ").trim();
// Map keys can't contain "." or start with "$" in MongoDB.
const safeKey = (key) => key.replace(/\./g, "_").replace(/^\$/, "_").slice(0, 80);

// Graph lead object → CRM lead fields + a one-line summary for the activity log.
export function mapMetaLead(raw) {
  const answers = Object.fromEntries((raw.field_data || []).map((f) => [
    String(f.name || "").toLowerCase(),
    Array.isArray(f.values) ? f.values.filter(Boolean).join(", ").trim() : "",
  ]));
  const take = (...keys) => keys.map((k) => answers[k]).find((v) => v);

  const custom = Object.entries(answers).filter(([k, v]) => v && !STANDARD_KEYS.has(k));
  const teamAnswer = custom.find(([k]) => /team|employee|people|participant|headcount|size/.test(k))?.[1];
  const teamSize = teamAnswer ? parseInt(teamAnswer.match(/\d+/)?.[0], 10) : undefined;
  const platform = String(raw.platform || "").toLowerCase();

  const fields = {
    name: take("full_name", "name") || [take("first_name"), take("last_name")].filter(Boolean).join(" ") || take("email") || "Meta lead",
    email: take("email"),
    phone: take("phone_number", "phone"),
    company: take("company_name", "company"),
    designation: take("job_title"),
    city: take("city"),
    state: take("state", "province"),
    country: take("country"),
    teamSize: Number.isFinite(teamSize) ? teamSize : undefined,
    interest: custom.map(([k, v]) => `${humanize(k)}: ${v}`).join("; ").slice(0, 1000) || undefined,
    source: raw.is_organic ? "social" : "meta_ads",
    priority: teamSize >= 10 ? "high" : "medium",
    utm: {
      utm_source: platform === "ig" || platform === "instagram" ? "instagram" : "facebook",
      utm_medium: raw.is_organic ? "social" : "paid_social",
      utm_campaign: raw.campaign_name,
      utm_content: raw.ad_name,
      utm_term: raw.adset_name,
      meta_form_id: raw.form_id,
      meta_ad_id: raw.ad_id,
    },
    customFields: {
      origin: "meta_lead_ads",
      metaFormId: raw.form_id,
      metaAdId: raw.ad_id,
      ...Object.fromEntries(custom.map(([k, v]) => [safeKey(k), v])),
    },
  };
  const summary = `Campaign: ${raw.campaign_name || "-"} · Ad: ${raw.ad_name || "-"} · Form: ${raw.form_id || "-"}`;
  return { fields, summary };
}

// Creates or matches the CRM lead for one Meta lead object. Safe to call repeatedly
// with the same lead (webhook redelivery, backfill overlap).
export async function processMetaLead(raw) {
  const leadgenId = String(raw.id);
  if (await CRMActivity.exists({ "metadata.leadgenId": leadgenId })) return { duplicate: true };

  const { fields, summary } = mapMetaLead(raw);
  try {
    const { lead, created } = await upsertCrmLead({
      fields,
      externalId: leadgenId,
      activityTitle: "Lead captured from Meta Lead Ads",
      activityBody: summary,
      repeatTitle: "Submitted again via Meta Lead Ads",
      metadata: { leadgenId, formId: raw.form_id, adId: raw.ad_id },
    });
    return { leadId: lead._id, created };
  } catch (err) {
    if (err?.code === 11000) return { duplicate: true }; // a concurrent redelivery got there first
    throw err;
  }
}

export const processMetaLeadgen = async ({ leadgenId }) => processMetaLead(await fetchMetaLead(leadgenId));
