import { upsertCrmLead } from "./crmLeadIntake.js";

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

/**
 * Creates a CRM lead for a site form submission that came from a paid ad.
 * Returns null for organic traffic. Never throws — the submission is already saved.
 */
export const routeAdLead = async ({ name, email, phone, company, interest, teamSize, utm, origin, originId, extra = {} }) => {
  try {
    const source = adSourceFromUtm(utm);
    if (!source || !name || (!email && !phone)) return null;

    const label = PLATFORM_LABEL[source];
    const campaign = utm.utm_campaign || "(no campaign)";
    const size = parseInt(teamSize, 10);

    const { lead } = await upsertCrmLead({
      fields: {
        name,
        email,
        phone,
        company,
        interest,
        teamSize: Number.isFinite(size) ? size : undefined,
        source,
        utm,
        priority: size >= 10 ? "high" : "medium",
        customFields: { origin, originId: originId ? String(originId) : undefined, ...extra },
      },
      activityTitle: `Lead captured from ${label} ad`,
      activityBody: `Campaign: ${campaign} · content: ${utm.utm_content || "-"} · via ${origin}`,
      repeatTitle: `Submitted again from ${label} ad`,
      metadata: { utm },
    });
    return lead;
  } catch (err) {
    console.error("[adLeadRouter] failed (submission already saved):", err.message);
    return null;
  }
};
