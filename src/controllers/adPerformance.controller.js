import { getAdPerformance } from "../services/metaAdInsights.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (d) => d.toISOString().slice(0, 10);

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to the last 30 days). Shared by the CRM and admin routes.
export const getAdPerformanceHandler = async (req, res) => {
  const to = req.query.to || isoDay(new Date());
  const from = req.query.from || isoDay(new Date(Date.parse(to) - 29 * 86400000));
  if (![from, to].every((d) => DATE.test(d) && !Number.isNaN(Date.parse(d)))) {
    return res.status(400).json({ success: false, message: "Use YYYY-MM-DD for 'from' and 'to'." });
  }
  if (from > to) return res.status(400).json({ success: false, message: "'from' must not be after 'to'." });

  try {
    res.json({ success: true, data: await getAdPerformance({ since: from, until: to }) });
  } catch (err) {
    console.error("[ad-performance]", err.message);
    res.status(err.status === 400 || err.status === 401 || err.status === 403 ? 502 : 500)
      .json({ success: false, message: `Could not load Meta ad insights: ${err.message}` });
  }
};
