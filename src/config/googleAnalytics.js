import { v1beta } from "@google-analytics/admin";

let client = null;

export function getGA4AdminClient() {
  if (!client) {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not configured");
    }
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    client = new v1beta.AnalyticsAdminServiceClient({ credentials });
  }
  return client;
}

export function getGA4PropertyPath() {
  if (!process.env.GA4_PROPERTY_ID) {
    throw new Error("GA4_PROPERTY_ID is not configured");
  }
  return `properties/${process.env.GA4_PROPERTY_ID}`;
}
