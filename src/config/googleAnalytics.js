import { v1beta } from "@google-analytics/admin";

let client = null;

// Distinguishes "credentials not set up yet" from a real Google API failure —
// callers check `err.code === "GA4_NOT_CONFIGURED"` rather than matching on
// err.message, which could false-positive on an unrelated SDK error string.
export class GA4NotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.code = "GA4_NOT_CONFIGURED";
  }
}

export function getGA4AdminClient() {
  if (!client) {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      throw new GA4NotConfiguredError("GOOGLE_SERVICE_ACCOUNT_KEY is not configured");
    }
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    client = new v1beta.AnalyticsAdminServiceClient({ credentials });
  }
  return client;
}

export function getGA4PropertyPath() {
  if (!process.env.GA4_PROPERTY_ID) {
    throw new GA4NotConfiguredError("GA4_PROPERTY_ID is not configured");
  }
  return `properties/${process.env.GA4_PROPERTY_ID}`;
}
