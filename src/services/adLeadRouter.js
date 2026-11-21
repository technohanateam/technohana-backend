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
const OUTREACH_MEDIUM = /^(outreach|outbound)$/i;
const PLATFORM_LABEL = {
  meta_ads: "Meta (Instagram/Facebook)", google_ads: "Google", linkedin_ads: "LinkedIn", campaign: "outbound outreach",
  promo_modal: "the website promo popup", website_enquiry: "a website form",
};
const NO_AD_SUFFIX = new Set(["campaign", "promo_modal", "website_enquiry"]);

// Organic links (utm_medium=social/organic/email) are not ad leads. Outbound outreach (our own
// WhatsApp/call lists) is a CRM source too, so people we message and who sign up are tracked.
export const adSourceFromUtm = (utm) => {
  if (!utm || typeof utm !== "object") return null;
  if (OUTREACH_MEDIUM.test(String(utm.utm_medium || ""))) return "campaign";

  const clickId = PLATFORM_BY_CLICK_ID.find(([key]) => utm[key]);
  const bySource = PLATFORM_BY_SOURCE.find(([re]) => re.test(String(utm.utm_source || "")));
  const isPaidMedium = PAID_MEDIUM.test(String(utm.utm_medium || ""));

  if (clickId) return clickId[1];
  if (bySource && isPaidMedium) return bySource[1];
  return null;
};

/**
 * Creates a CRM lead for a site form submission. A paid-ad / outreach UTM wins; otherwise the
 * caller's `fallbackSource` (organic website forms) is used, and with neither it returns null.
 * Never throws — the submission is already saved.
 */
export const routeAdLead = async ({
  name, email, phone, company, interest, teamSize, utm, origin, originId, extra = {},
  fallbackSource, priority,
}) => {
  try {
    const source = adSourceFromUtm(utm) || fallbackSource;
    if (!source || !name || (!email && !phone)) return null;

    const label = PLATFORM_LABEL[source];
    const suffix = NO_AD_SUFFIX.has(source) ? "" : " ad";
    const campaign = utm?.utm_campaign || "(no campaign)";
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
        utm: utm && typeof utm === "object" ? utm : {},
        priority: size >= 10 ? "high" : priority || "medium",
        customFields: { origin, originId: originId ? String(originId) : undefined, ...extra },
      },
      activityTitle: `Lead captured from ${label}${suffix}`,
      activityBody: `${extra.enquiryType ? `${extra.enquiryType} · ` : ""}Campaign: ${campaign} · content: ${utm?.utm_content || "-"} · via ${origin}`,
      repeatTitle: `Submitted again from ${label}${suffix}`,
      metadata: { utm },
    });
    return lead;
  } catch (err) {
    console.error("[adLeadRouter] failed (submission already saved):", err.message);
    return null;
  }
};
