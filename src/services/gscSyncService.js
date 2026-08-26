import { google } from "googleapis";
import SeoGscMetric from "../models/seoGscMetric.model.js";
import SeoGscSitemap from "../models/seoGscSitemap.model.js";

const DIMENSION_SETS = [
  { dimensionType: "query", apiDimension: "query" },
  { dimensionType: "page", apiDimension: "page" },
  { dimensionType: "country", apiDimension: "country" },
  { dimensionType: "device", apiDimension: "device" },
  { dimensionType: "date", apiDimension: "date" },
];

const PAGE_SIZE = 5000;

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// authedClient is injected (rather than constructed here) so unit tests can
// pass a stub — this function never talks to Google directly.
export async function syncGscProperty({ propertyId, authedClient, startDate, endDate }) {
  const searchconsole = google.searchconsole({ version: "v1", auth: authedClient });
  const start = startDate || toDateStr(new Date(Date.now() - 27 * 86400000));
  const end = endDate || toDateStr(new Date(Date.now() - 2 * 86400000)); // GSC data lags ~2 days

  let totalRows = 0;

  for (const { dimensionType, apiDimension } of DIMENSION_SETS) {
    let startRow = 0;
    let pageRowCount = 0;

    do {
      const { data } = await searchconsole.searchanalytics.query({
        siteUrl: propertyId,
        requestBody: {
          startDate: start,
          endDate: end,
          dimensions: [apiDimension],
          rowLimit: PAGE_SIZE,
          startRow,
        },
      });

      const rows = data.rows || [];
      pageRowCount = rows.length;

      for (const row of rows) {
        const dimensionValue = row.keys?.[0] ?? "";
        // Non-"date" dimensions are a rolling window snapshot, not a per-day
        // history — key the upsert without `date` so each sync updates the
        // one current row for this dimension value instead of inserting a
        // new duplicate every day (see partial indexes on the model).
        const isDateDim = dimensionType === "date";
        const rowDate = isDateDim ? new Date(dimensionValue) : new Date(end);
        const filter = isDateDim
          ? { propertyId, dimensionType, dimensionValue, date: rowDate }
          : { propertyId, dimensionType, dimensionValue };

        await SeoGscMetric.findOneAndUpdate(
          filter,
          {
            $set: {
              date: rowDate,
              clicks: row.clicks || 0,
              impressions: row.impressions || 0,
              ctr: row.ctr || 0,
              position: row.position || 0,
              syncedAt: new Date(),
            },
          },
          { upsert: true }
        );
        totalRows += 1;
      }

      startRow += PAGE_SIZE;
    } while (pageRowCount === PAGE_SIZE);
  }

  // Sitemaps reflect current state only (GSC gives no history for these).
  // Isolated in its own try/catch: a sitemaps.list failure shouldn't mark an
  // otherwise-successful metrics sync as failed.
  let sitemapsSynced = 0;
  try {
    const { data: sitemapData } = await searchconsole.sitemaps.list({ siteUrl: propertyId });
    const sitemaps = sitemapData.sitemap || [];
    for (const sitemap of sitemaps) {
      const set = {
        isPending: sitemap.isPending,
        isSitemapsIndex: sitemap.isSitemapsIndex,
        warnings: Number(sitemap.warnings || 0),
        errors: Number(sitemap.errors || 0),
        contents: (sitemap.contents || []).map((c) => ({
          type: c.type,
          submitted: Number(c.submitted || 0),
          indexed: Number(c.indexed || 0),
        })),
        syncedAt: new Date(),
      };
      // Omit the key entirely when the source value is missing rather than
      // explicitly setting undefined, which can overwrite a previously
      // known-good value with null.
      if (sitemap.lastSubmitted) set.lastSubmitted = new Date(sitemap.lastSubmitted);
      if (sitemap.lastDownloaded) set.lastDownloaded = new Date(sitemap.lastDownloaded);

      await SeoGscSitemap.findOneAndUpdate({ propertyId, path: sitemap.path }, { $set: set }, { upsert: true });
    }
    sitemapsSynced = sitemaps.length;
  } catch (err) {
    console.error(`[GSC Sync] sitemap sync failed for ${propertyId} (metrics sync unaffected):`, err.message);
  }

  return { rowsSynced: totalRows, sitemapsSynced };
}

export async function inspectUrl({ propertyId, url, authedClient }) {
  const searchconsole = google.searchconsole({ version: "v1", auth: authedClient });
  const { data } = await searchconsole.urlInspection.index.inspect({
    requestBody: { inspectionUrl: url, siteUrl: propertyId },
  });
  return data;
}

export async function submitSitemap({ propertyId, sitemapUrl, authedClient }) {
  const searchconsole = google.searchconsole({ version: "v1", auth: authedClient });
  await searchconsole.sitemaps.submit({ siteUrl: propertyId, feedpath: sitemapUrl });
}

export async function listVerifiedSites(authedClient) {
  const searchconsole = google.searchconsole({ version: "v1", auth: authedClient });
  const { data } = await searchconsole.sites.list();
  return (data.siteEntry || []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
}
