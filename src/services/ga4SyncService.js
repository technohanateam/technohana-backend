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
];

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function metricValue(metricHeaders, metricValues, name) {
  const idx = metricHeaders.findIndex((h) => h.name === name);
  return idx === -1 ? 0 : Number(metricValues[idx]?.value || 0);
}

// authedClient is injected so unit tests can pass a stub.
export async function syncGa4Property({ propertyId, authedClient, startDate, endDate }) {
  const analyticsdata = getGa4DataClient(authedClient);
  const start = startDate || toDateStr(new Date(Date.now() - 27 * 86400000));
  const end = endDate || toDateStr(new Date());

  let totalRows = 0;

  for (const { dimensionType, apiDimension } of DIMENSION_SETS) {
    const { data } = await analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: start, endDate: end }],
        dimensions: [{ name: apiDimension }],
        metrics: METRICS,
        limit: 5000,
      },
    });

    const metricHeaders = data.metricHeaders || [];
    const rows = data.rows || [];

    for (const row of rows) {
      const dimensionValue = row.dimensionValues?.[0]?.value ?? "";
      const metricValues = row.metricValues || [];

      await SeoGa4Metric.findOneAndUpdate(
        { propertyId, date: new Date(end), dimensionType, dimensionValue },
        {
          $set: {
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
  }

  return { rowsSynced: totalRows };
}
