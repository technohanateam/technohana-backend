import { google } from "googleapis";

// GA4 Data API (reporting) client — distinct from the existing GA4 Admin
// API client in src/config/googleAnalytics.js (used for Key Events).
export function getGa4DataClient(authedClient) {
  return google.analyticsdata({ version: "v1beta", auth: authedClient });
}
