// Thin LinkedIn Marketing API readers used by the CRM (ad accounts, campaigns, lead forms, analytics).
import { linkedinFetch } from "../config/linkedinClient.js";

const enc = encodeURIComponent;
const idOf = (urn) => String(urn || "").split(":").pop();
export const accountId = (urn) => idOf(urn);
const restliList = (urns) => `List(${urns.map(enc).join(",")})`;
const restliDay = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return `(year:${year},month:${month},day:${day})`;
};

export async function listAdAccounts(connection) {
  const json = await linkedinFetch(connection, "/adAccounts", { params: { q: "search" } });
  return (json.elements || []).map((a) => ({
    urn: `urn:li:sponsoredAccount:${a.id}`, id: String(a.id), name: a.name, currency: a.currency, status: a.status,
  }));
}

// campaign id → { name, urn } for the connected ad account.
export async function listCampaigns(connection) {
  const json = await linkedinFetch(connection, `/adAccounts/${idOf(connection.adAccountUrn)}/adCampaigns`, {
    params: { q: "search", pageSize: 100 },
  });
  return new Map((json.elements || []).map((c) => [String(c.id), { name: c.name, urn: `urn:li:sponsoredCampaign:${c.id}` }]));
}

export async function listLeadGenForms(connection) {
  const json = await linkedinFetch(connection, "/leadForms", { params: { q: "account", account: enc(connection.adAccountUrn) } });
  return json.elements || [];
}

// Lead Gen Form responses for one form, newest pages first, stopping once older than `sinceMs`.
export async function listFormResponses(connection, formUrn, sinceMs = 0, maxPages = 10) {
  const pageSize = 100;
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const json = await linkedinFetch(connection, "/leadFormResponses", {
      params: { q: "form", form: enc(formUrn), start: page * pageSize, count: pageSize },
    });
    const els = json.elements || [];
    out.push(...els.filter((e) => (e.submittedAt || 0) > sinceMs));
    if (els.length < pageSize) break;
  }
  return out;
}

// Per-campaign spend/impressions/clicks/leads for [since, until] (YYYY-MM-DD).
export async function getCampaignAnalytics(connection, since, until) {
  const json = await linkedinFetch(connection, "/adAnalytics", {
    params: {
      q: "analytics",
      pivot: "CAMPAIGN",
      dateRange: `(start:${restliDay(since)},end:${restliDay(until)})`,
      timeGranularity: "ALL",
      accounts: restliList([connection.adAccountUrn]),
      fields: "pivotValues,impressions,clicks,costInLocalCurrency,oneClickLeads,externalWebsiteConversions",
    },
  });
  return json.elements || [];
}
