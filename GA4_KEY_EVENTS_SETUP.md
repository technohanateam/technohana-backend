# GA4 Key Events Admin Panel — Setup Guide

Lets admins manage GA4 Key Events (conversions) from the Technohana admin panel
(SEO Analysis page) instead of the GA4 web console. Backed by the Google
Analytics Admin API — see `src/config/googleAnalytics.js` and the
`/admin/ga4-key-events` routes in `src/routes/seo-geo.routes.js`.

## 1. Enable the API

In [Google Cloud Console](https://console.cloud.google.com/), select (or create)
the project tied to your GA4 property, then enable **Google Analytics Admin API**
under APIs & Services → Library.

## 2. Create a service account

APIs & Services → Credentials → Create Credentials → Service Account.
Give it any name (e.g. `technohana-ga4-admin`). No project-level IAM role is
needed — access is granted on the GA4 property directly (step 3).

Once created, open the service account → Keys → Add Key → Create new key →
JSON. This downloads a `.json` credentials file — keep it private, never
commit it.

## 3. Grant the service account access on the GA4 property

In [Google Analytics](https://analytics.google.com/) → Admin → Property →
Property Access Management → **+** → Add the service account's email
(looks like `technohana-ga4-admin@your-project.iam.gserviceaccount.com`) →
role **Editor** (required to create/delete Key Events, not just view them).

## 4. Set environment variables

- `GA4_PROPERTY_ID` — your numeric GA4 property ID (Admin → Property Settings,
  shown as "Property ID", e.g. `123456789` — do **not** include `properties/`).
- `GOOGLE_SERVICE_ACCOUNT_KEY` — the entire contents of the JSON key file from
  step 2, pasted as a single-line JSON string.

Never commit either of these — set them in your `.env` locally and in
Railway's environment variables for production.

## 5. Verify

Once both env vars are set, `GET /admin/ga4-key-events` (via the SEO Analysis
admin page) should list your property's current Key Events instead of
returning the "GA4 isn't connected yet" message.
