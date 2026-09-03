import { getGa4DataClient } from "../config/googleGa4Data.js";
import SeoGa4Metric from "../models/seoGa4Metric.model.js";

const METRICS = [
  { name: "sessions" },
  { name: "totalUsers" },
  { name: "newUsers" },
  { name: "engagedSessions" },
  { name: "engagementRate" },
  { name: "averageSessionDuration" },
  { name: "bounceRate" },
  { name: "conversions" },
  { name: "eventCount" },
];

const DIMENSION_SETS = [
  { dimensionType: "landingPage", apiDimension: "landingPagePlusQueryString" },
  { dimensionType: "event", apiDimension: "eventName" },
  { dimensionType: "trafficSource", apiDimension: "sessionDefaultChannelGroup" },
  { dimensionType: "device", apiDimension: "deviceCategory" },
  { dimensionType: "country", apiDimension: "country" },
  { dimensionType: "date", apiDimension: "date" },
];

const PAGE_SIZE = 5000;

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function metricValue(metricHeaders, metricValues, name) {
  const idx = metricHeaders.findIndex((h) => h.name === name);
  return idx === -1 ? 0 : Number(metricValues[idx]?.value || 0);
}

// GA4's "date" dimension returns values as "YYYYMMDD" with no separators —
// `new Date("20260902")` is not a format the Date constructor reliably
// parses, so build the UTC date explicitly.
function parseGa4Date(value) {
  return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))));
}

// authedClient is injected so unit tests can pass a stub.
export async function syncGa4Property({ propertyId, authedClient, startDate, endDate }) {
  const analyticsdata = getGa4DataClient(authedClient);
  const start = startDate || toDateStr(new Date(Date.now() - 27 * 86400000));
  const end = endDate || toDateStr(new Date());

  let totalRows = 0;

  for (const { dimensionType, apiDimension } of DIMENSION_SETS) {
    let offset = 0;
    let pageRowCount = 0;

    do {
      const { data } = await analyticsdata.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dateRanges: [{ startDate: start, endDate: end }],
          dimensions: [{ name: apiDimension }],
          metrics: METRICS,
          limit: PAGE_SIZE,
          offset,
        },
      });

      const metricHeaders = data.metricHeaders || [];
      const rows = data.rows || [];
      pageRowCount = rows.length;

      for (const row of rows) {
        const dimensionValue = row.dimensionValues?.[0]?.value ?? "";
        const metricValues = row.metricValues || [];
        // Non-"date" dimensions represent a rolling window snapshot, not a
        // per-day history — key the upsert without `date` so each sync
        // updates the one current row for this dimension value instead of
        // inserting a new duplicate every day (see partial indexes on the
        // model). "date" dimensionType rows keep their real calendar date
        // in the key, giving the per-day GA4 trend the summary/date-range
        // queries rely on.
        const isDateDim = dimensionType === "date";
        const rowDate = isDateDim ? parseGa4Date(dimensionValue) : new Date(end);
        const filter = isDateDim
          ? { propertyId, dimensionType, dimensionValue, date: rowDate }
          : { propertyId, dimensionType, dimensionValue };

        await SeoGa4Metric.findOneAndUpdate(
          filter,
          {
            $set: {
              date: rowDate,
              sessions: metricValue(metricHeaders, metricValues, "sessions"),
              users: metricValue(metricHeaders, metricValues, "totalUsers"),
              newUsers: metricValue(metricHeaders, metricValues, "newUsers"),
              engagedSessions: metricValue(metricHeaders, metricValues, "engagedSessions"),
              engagementRate: metricValue(metricHeaders, metricValues, "engagementRate"),
              avgEngagementTime: metricValue(metricHeaders, metricValues, "averageSessionDuration"),
              bounceRate: metricValue(metricHeaders, metricValues, "bounceRate"),
              conversions: metricValue(metricHeaders, metricValues, "conversions"),
              eventCount: metricValue(metricHeaders, metricValues, "eventCount"),
              syncedAt: new Date(),
            },
          },
          { upsert: true }
        );
        totalRows += 1;
      }

      offset += PAGE_SIZE;
    } while (pageRowCount === PAGE_SIZE);
  }

  return { rowsSynced: totalRows };
}
