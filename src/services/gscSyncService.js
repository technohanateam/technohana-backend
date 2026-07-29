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
    const { data } = await searchconsole.searchanalytics.query({
      siteUrl: propertyId,
      requestBody: {
        startDate: start,
        endDate: end,
        dimensions: [apiDimension],
        rowLimit: 5000,
      },
    });

    const rows = data.rows || [];
    for (const row of rows) {
      const dimensionValue = row.keys?.[0] ?? "";
      const rowDate = dimensionType === "date" ? new Date(dimensionValue) : new Date(end);

      await SeoGscMetric.findOneAndUpdate(
        { propertyId, date: rowDate, dimensionType, dimensionValue },
        {
          $set: {
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
  }

  // Sitemaps reflect current state only (GSC gives no history for these).
  const { data: sitemapData } = await searchconsole.sitemaps.list({ siteUrl: propertyId });
  for (const sitemap of sitemapData.sitemap || []) {
    await SeoGscSitemap.findOneAndUpdate(
      { propertyId, path: sitemap.path },
      {
        $set: {
          lastSubmitted: sitemap.lastSubmitted ? new Date(sitemap.lastSubmitted) : undefined,
          lastDownloaded: sitemap.lastDownloaded ? new Date(sitemap.lastDownloaded) : undefined,
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
        },
      },
      { upsert: true }
    );
  }

  return { rowsSynced: totalRows, sitemapsSynced: (sitemapData.sitemap || []).length };
}

export async function inspectUrl({ propertyId, url, authedClient }) {
  const searchconsole = google.searchconsole({ version: "v1", auth: authedClient });
  const { data } = await searchconsole.urlInspection.index.inspect({
    requestBody: { inspectionUrl: url, siteUrl: propertyId },
  });
  return data;
}

export async function listVerifiedSites(authedClient) {
  const searchconsole = google.searchconsole({ version: "v1", auth: authedClient });
  const { data } = await searchconsole.sites.list();
  return (data.siteEntry || []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
}
