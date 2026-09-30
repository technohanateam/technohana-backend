import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CrmUser from "../models/crmUser.model.js";

const PLATFORM_BY_SOURCE = [
  [/^(instagram|ig|facebook|fb|meta)\b/i, "meta_ads"],
  [/^google\b/i, "google_ads"],
  [/^(linkedin|li)\b/i, "linkedin_ads"],
];
// Only gclid (Google Ads auto-tagging) proves a paid click on its own. Facebook/Instagram append fbclid to
// organic outbound links as well, so Meta leads need a paid utm_medium.
const PLATFORM_BY_CLICK_ID = [["gclid", "google_ads"]];
const PAID_MEDIUM = /^(paid|cpc|ppc|paid[_-]?social|paidsocial|sponsored|display|ads?)$/i;
const PLATFORM_LABEL = { meta_ads: "Meta (Instagram/Facebook)", google_ads: "Google", linkedin_ads: "LinkedIn" };
const CLOSED_STATUSES = ["won", "lost", "junk"];

// Organic links (utm_medium=social/organic/email) are not ad leads.
export const adSourceFromUtm = (utm) => {
  if (!utm || typeof utm !== "object") return null;

  const clickId = PLATFORM_BY_CLICK_ID.find(([key]) => utm[key]);
  const bySource = PLATFORM_BY_SOURCE.find(([re]) => re.test(String(utm.utm_source || "")));
  const isPaidMedium = PAID_MEDIUM.test(String(utm.utm_medium || ""));

  if (clickId) return clickId[1];
  if (bySource && isPaidMedium) return bySource[1];
  return null;
};

// Least-loaded active sales rep gets the lead; owners/admins are the fallback so it is never invisible.
const pickAssignee = async () => {
  for (const roles of [["sales"], ["super_admin", "admin"]]) {
    const users = await CrmUser.find({ active: true, crmRole: { $in: roles } }).select("_id").lean();
    if (!users.length) continue;
    const loads = await Promise.all(
      users.map(async (u) => ({
        id: u._id,
        open: await CRMLead.countDocuments({ assignedTo: u._id, isDeleted: false, status: { $nin: CLOSED_STATUSES } }),
      }))
    );
    return loads.sort((a, b) => a.open - b.open)[0].id;
  }
  return undefined;
};

const logActivity = (leadId, title, body, utm) =>
  CRMActivity.create({
    type: "created",
    title,
    body,
    relatedToType: "lead",
    relatedToId: leadId,
    metadata: { utm },
  });

/**
 * Creates a CRM lead for a site form submission that came from a paid ad.
 * Returns null for organic traffic. Never throws — the submission is already saved.
 */
export const routeAdLead = async ({ name, email, phone, company, interest, teamSize, utm, origin, originId, extra = {} }) => {
  try {
    const source = adSourceFromUtm(utm);
    if (!source || !name || (!email && !phone)) return null;

    const normalizedEmail = email ? String(email).toLowerCase().trim() : undefined;
    const label = PLATFORM_LABEL[source];
    const campaign = utm.utm_campaign || "(no campaign)";

    const existing = await CRMLead.findOne({
      isDeleted: false,
      $or: [...(normalizedEmail ? [{ email: normalizedEmail }] : []), ...(phone ? [{ phone }] : [])],
    }).select("_id");

    if (existing) {
      await logActivity(existing._id, `Submitted again from ${label} ad`, `Campaign: ${campaign} · via ${origin}`, utm);
      return existing;
    }

    const size = parseInt(teamSize, 10);
    const lead = await CRMLead.create({
      name,
      email: normalizedEmail,
      phone,
      company,
      interest,
      teamSize: Number.isFinite(size) ? size : undefined,
      source,
      utm,
      priority: size >= 10 ? "high" : "medium",
      status: "new",
      assignedTo: await pickAssignee(),
      customFields: { origin, originId: originId ? String(originId) : undefined, ...extra },
    });

    await logActivity(lead._id, `Lead captured from ${label} ad`, `Campaign: ${campaign} · content: ${utm.utm_content || "-"} · via ${origin}`, utm);
    return lead;
  } catch (err) {
    console.error("[adLeadRouter] failed (submission already saved):", err.message);
    return null;
  }
};
