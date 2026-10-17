// Meta (Facebook/Instagram) ad performance: Marketing API spend/clicks per ad and
// platform, joined with the CRM leads and won deals that ad produced.
import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import { graphGet } from "./metaLeadAds.js";

const CACHE_MS = 5 * 60 * 1000;
const MAX_PAGES = 5;
const INSIGHT_FIELDS = "account_currency,campaign_id,campaign_name,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,ctr,cpc,actions";
const LEAD_ACTIONS = new Set(["lead", "onsite_conversion.lead_grouped"]);
const cache = new Map();

export const isMetaAdsConfigured = () => !!(process.env.META_AD_ACCOUNT_ID && (process.env.META_ADS_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN));

// utm_source is "fb"/"ig" for site-form clicks ({{site_source_name}}) and facebook/instagram for Lead Ads.
export const platformFromSource = (source) => {
  const s = String(source || "").toLowerCase();
  if (s === "ig" || s === "instagram") return "instagram";
  if (s === "fb" || s === "facebook") return "facebook";
  return s || "unknown";
};

const num = (v) => Number(v) || 0;
const accountPath = () => `act_${String(process.env.META_AD_ACCOUNT_ID).replace(/^act_/, "")}`;

async function fetchInsightRows(since, until) {
  const token = process.env.META_ADS_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
  const rows = [];
  let after;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await graphGet(`${accountPath()}/insights`, {
      level: "ad",
      fields: INSIGHT_FIELDS,
      breakdowns: "publisher_platform",
      time_range: JSON.stringify({ since, until }),
      limit: "200",
      ...(after && { after }),
    }, token);
    rows.push(...(body.data || []));
    after = body.paging?.next ? body.paging.cursors?.after : null;
    if (!after) break;
  }
  return rows;
}

// Leads and won revenue per (campaign, ad id/name, platform) for Meta-sourced CRM leads.
async function crmAttribution(since, until) {
  const range = { $gte: new Date(`${since}T00:00:00.000Z`), $lte: new Date(`${until}T23:59:59.999Z`) };
  const groupId = {
    campaign: "$utm.utm_campaign", adId: "$utm.meta_ad_id", adName: "$utm.utm_content", source: "$utm.utm_source",
  };
  const [leads, wins] = await Promise.all([
    CRMLead.aggregate([
      { $match: { isDeleted: false, source: "meta_ads", createdAt: range } },
      { $group: { _id: groupId, leads: { $sum: 1 } } },
    ]),
    CRMDeal.aggregate([
      { $match: { isDeleted: false, status: "won", lead: { $exists: true } } },
      { $lookup: { from: CRMLead.collection.name, localField: "lead", foreignField: "_id", as: "l" } },
      { $unwind: "$l" },
      { $match: { "l.source": "meta_ads", "l.createdAt": range } },
      { $group: {
        _id: { campaign: "$l.utm.utm_campaign", adId: "$l.utm.meta_ad_id", adName: "$l.utm.utm_content", source: "$l.utm.utm_source" },
        won: { $sum: 1 }, revenue: { $sum: "$value" },
      } },
    ]),
  ]);

  const byKey = new Map();
  const add = ({ _id, ...stats }) => {
    const platform = platformFromSource(_id.source);
    const ref = _id.adId ? `id:${_id.adId}` : `name:${String(_id.adName || "").toLowerCase()}`;
    const key = `${ref}|${platform}`;
    const entry = byKey.get(key) || { leads: 0, won: 0, revenue: 0, campaign: _id.campaign, adName: _id.adName, adId: _id.adId, platform };
    Object.assign(entry, { leads: entry.leads + (stats.leads || 0), won: entry.won + (stats.won || 0), revenue: entry.revenue + (stats.revenue || 0) });
    byKey.set(key, entry);
  };
  leads.forEach(add);
  wins.forEach(add);
  return byKey;
}

const withRatios = (r) => ({
  ...r,
  cpl: r.leads && r.spend != null ? r.spend / r.leads : null,
  costPerWon: r.won && r.spend != null ? r.spend / r.won : null,
  roas: r.spend ? r.revenue / r.spend : null,
});

/**
 * Per-ad, per-platform performance for [since, until] (YYYY-MM-DD).
 * Without Marketing API credentials it still returns CRM lead counts (spend = null).
 */
export async function getAdPerformance({ since, until }) {
  const cacheKey = `${since}|${until}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const configured = isMetaAdsConfigured();
  const [insights, attribution] = await Promise.all([
    configured ? fetchInsightRows(since, until) : [],
    crmAttribution(since, until),
  ]);

  const used = new Set();
  const rows = insights.map((i) => {
    const platform = platformFromSource(i.publisher_platform);
    const byId = `id:${i.ad_id}|${platform}`;
    const byName = `name:${String(i.ad_name || "").toLowerCase()}|${platform}`;
    const crmKey = attribution.has(byId) ? byId : attribution.has(byName) ? byName : null;
    if (crmKey) used.add(crmKey);
    const crm = crmKey ? attribution.get(crmKey) : { leads: 0, won: 0, revenue: 0 };
    return withRatios({
      campaign: i.campaign_name, adset: i.adset_name, adId: i.ad_id, adName: i.ad_name, platform,
      currency: i.account_currency,
      spend: num(i.spend), impressions: num(i.impressions), reach: num(i.reach), clicks: num(i.clicks),
      ctr: num(i.ctr), cpc: num(i.cpc),
      metaLeads: num((i.actions || []).filter((a) => LEAD_ACTIONS.has(a.action_type)).reduce((s, a) => s + num(a.value), 0)),
      leads: crm.leads, won: crm.won, revenue: crm.revenue,
    });
  });

  // CRM leads whose ad has no insights row (deleted ad, outside range, or insights not configured).
  for (const [key, c] of attribution) {
    if (used.has(key)) continue;
    rows.push(withRatios({
      campaign: c.campaign, adset: null, adId: c.adId || null, adName: c.adName, platform: c.platform, currency: null,
      spend: null, impressions: null, reach: null, clicks: null, ctr: null, cpc: null, metaLeads: null,
      leads: c.leads, won: c.won, revenue: c.revenue,
    }));
  }

  rows.sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1) || b.leads - a.leads);

  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const totals = withRatios({
    spend: configured ? sum("spend") : null, impressions: sum("impressions"), clicks: sum("clicks"),
    leads: sum("leads"), won: sum("won"), revenue: sum("revenue"),
  });

  const data = { configured, since, until, currency: insights[0]?.account_currency || null, rows, totals };
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}
