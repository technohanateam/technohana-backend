import { getAdPerformance, withRatios } from "../services/metaAdInsights.js";
import { getLinkedinPerformance } from "../services/linkedinAdInsights.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (d) => d.toISOString().slice(0, 10);

// Meta and LinkedIn load independently so one platform failing doesn't blank the other.
async function loadPerformance(since, until) {
  const [meta, linkedin] = await Promise.allSettled([
    getAdPerformance({ since, until }),
    getLinkedinPerformance({ since, until }),
  ]);
  if (meta.status === "rejected" && linkedin.status === "rejected") throw meta.reason;

  const metaData = meta.status === "fulfilled" ? meta.value : { configured: false, currency: null, rows: [] };
  const liData = linkedin.status === "fulfilled" ? linkedin.value : { configured: false, currency: null, rows: [] };
  const rows = [...metaData.rows, ...liData.rows].sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1) || b.leads - a.leads);

  const currencies = [metaData.currency, liData.currency].filter(Boolean);
  const mixedCurrency = new Set(currencies).size > 1;
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const configured = metaData.configured || liData.configured;
  const totals = withRatios({
    spend: configured ? sum("spend") : null, impressions: sum("impressions"), clicks: sum("clicks"),
    leads: sum("leads"), won: sum("won"), revenue: sum("revenue"),
  });

  return {
    configured: metaData.configured,
    linkedinConfigured: liData.configured,
    since, until,
    currency: currencies[0] || null,
    mixedCurrency,
    rows, totals,
    errors: {
      ...(meta.status === "rejected" && { meta: meta.reason.message }),
      ...(linkedin.status === "rejected" && { linkedin: linkedin.reason.message }),
    },
  };
}

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to the last 30 days). Shared by the CRM and admin routes.
export const getAdPerformanceHandler = async (req, res) => {
  const to = req.query.to || isoDay(new Date());
  const from = req.query.from || isoDay(new Date(Date.parse(to) - 29 * 86400000));
  if (![from, to].every((d) => DATE.test(d) && !Number.isNaN(Date.parse(d)))) {
    return res.status(400).json({ success: false, message: "Use YYYY-MM-DD for 'from' and 'to'." });
  }
  if (from > to) return res.status(400).json({ success: false, message: "'from' must not be after 'to'." });

  try {
    res.json({ success: true, data: await loadPerformance(from, to) });
  } catch (err) {
    console.error("[ad-performance]", err.message);
    res.status(err.status === 400 || err.status === 401 || err.status === 403 ? 502 : 500)
      .json({ success: false, message: `Could not load ad insights: ${err.message}` });
  }
};
