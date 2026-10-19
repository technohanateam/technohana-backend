// LinkedIn campaign performance (spend/clicks) joined with the CRM leads and won deals it produced.
import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CrmLinkedinConnection from "../models/crm/crmLinkedinConnection.model.js";
import { getCampaignAnalytics, listCampaigns } from "./linkedinService.js";
import { withRatios } from "./metaAdInsights.js";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
const num = (v) => Number(v) || 0;
const idOf = (urn) => String(urn || "").split(":").pop();

async function crmAttribution(since, until) {
  const range = { $gte: new Date(`${since}T00:00:00.000Z`), $lte: new Date(`${until}T23:59:59.999Z`) };
  const group = { campaignId: "$utm.linkedin_campaign_id", campaign: "$utm.utm_campaign" };
  const [leads, wins] = await Promise.all([
    CRMLead.aggregate([
      { $match: { isDeleted: false, source: "linkedin_ads", createdAt: range } },
      { $group: { _id: group, leads: { $sum: 1 } } },
    ]),
    CRMDeal.aggregate([
      { $match: { isDeleted: false, status: "won", lead: { $exists: true } } },
      { $lookup: { from: CRMLead.collection.name, localField: "lead", foreignField: "_id", as: "l" } },
      { $unwind: "$l" },
      { $match: { "l.source": "linkedin_ads", "l.createdAt": range } },
      { $group: { _id: { campaignId: "$l.utm.linkedin_campaign_id", campaign: "$l.utm.utm_campaign" }, won: { $sum: 1 }, revenue: { $sum: "$value" } } },
    ]),
  ]);

  const byKey = new Map();
  const add = ({ _id, ...stats }) => {
    const key = _id.campaignId ? `id:${_id.campaignId}` : `name:${String(_id.campaign || "").toLowerCase()}`;
    const entry = byKey.get(key) || { leads: 0, won: 0, revenue: 0, campaign: _id.campaign, campaignId: _id.campaignId };
    entry.leads += stats.leads || 0;
    entry.won += stats.won || 0;
    entry.revenue += stats.revenue || 0;
    byKey.set(key, entry);
  };
  leads.forEach(add);
  wins.forEach(add);
  return byKey;
}

export async function getLinkedinPerformance({ since, until }) {
  const conn = await CrmLinkedinConnection.findOne({ key: "default", isActive: true });
  const configured = Boolean(conn?.adAccountUrn);
  const cacheKey = `${since}|${until}|${configured}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const [analytics, campaigns, attribution] = await Promise.all([
    configured ? getCampaignAnalytics(conn, since, until) : [],
    configured ? listCampaigns(conn) : new Map(),
    crmAttribution(since, until),
  ]);

  const used = new Set();
  const rows = analytics.map((a) => {
    const campaignId = idOf(a.pivotValues?.[0]);
    const name = campaigns.get(campaignId)?.name || `Campaign ${campaignId}`;
    const byId = `id:${campaignId}`;
    const byName = `name:${name.toLowerCase()}`;
    const crmKey = attribution.has(byId) ? byId : attribution.has(byName) ? byName : null;
    if (crmKey) used.add(crmKey);
    const crm = crmKey ? attribution.get(crmKey) : { leads: 0, won: 0, revenue: 0 };
    const clicks = num(a.clicks);
    const impressions = num(a.impressions);
    const spend = num(a.costInLocalCurrency);
    return withRatios({
      campaign: name, adset: null, adId: campaignId, adName: name, platform: "linkedin", currency: conn.currency || null,
      spend, impressions, reach: null, clicks,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      cpc: clicks ? spend / clicks : 0,
      metaLeads: num(a.oneClickLeads),
      leads: crm.leads, won: crm.won, revenue: crm.revenue,
    });
  });

  for (const [key, c] of attribution) {
    if (used.has(key)) continue;
    rows.push(withRatios({
      campaign: c.campaign, adset: null, adId: c.campaignId || null, adName: c.campaign, platform: "linkedin", currency: null,
      spend: null, impressions: null, reach: null, clicks: null, ctr: null, cpc: null, metaLeads: null,
      leads: c.leads, won: c.won, revenue: c.revenue,
    }));
  }

  const data = { configured, currency: conn?.currency || null, rows };
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}
