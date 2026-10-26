# Environment Variables Reference

Audited against actual `process.env.*` usage in `src/` (Phase 5.3 production polish, 2026-07-29). Supersedes the shorter list in `CLAUDE.md`, which is kept as the quick-reference subset.

## Required

Missing any of these causes the server to fail fast on startup (see `src/index.js`, "Startup Config Validation").

| Variable | Used by | Purpose |
|---|---|---|
| `MONGO_DB` | `src/config/db.js` | MongoDB connection string |
| `JWT_SECRET` | `src/config/jwt.js`, `src/middleware/authenticateInstructor.js`, `src/routes/instructor.routes.js` | User/instructor auth token signing |
| `ADMIN_JWT_SECRET` | `src/middleware/authenticateAdmin.js`, `src/controllers/adminUser.controller.js`, `src/controllers/seoConnection.controller.js` | Admin auth token signing |
| `CRM_JWT_SECRET` | `src/middleware/authenticateCrm.js`, `src/controllers/crmUser.controller.js` | CRM token signing (must differ from `ADMIN_JWT_SECRET`); server refuses to start without it |
| `CRM_FRONTEND_URL` | `src/controllers/crmUser.controller.js` | CRM app base URL for password-reset links (e.g. `https://crm.technohana.in`); also add it to `WHITELISTED_URLS` |
| `STRIPE_SECRET` | `src/index.js` | Stripe SDK init (international payments) |

## Optional — feature degrades gracefully or has a fallback if unset

| Variable | Used by | Notes |
|---|---|---|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | `src/index.js` | India/INR payments; Razorpay-specific endpoints will fail without them, rest of the app is unaffected |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `BASE_URL` | `src/config/passport.js` | Google OAuth login |
| `SEO_GOOGLE_CLIENT_ID` / `SEO_GOOGLE_CLIENT_SECRET` / `SEO_GOOGLE_REDIRECT_URI` | `src/config/googleSeoOAuth.js` | Search Console/GA4 OAuth connect flow (SEO Intelligence admin) |
| `GA4_PROPERTY_ID` / `GOOGLE_SERVICE_ACCOUNT_KEY` | `src/config/googleAnalytics.js` | GA4 Key Events admin panel |
| `RESEND_API_KEY` | `src/config/emailService.js` and callers | Transactional email; sends will fail silently-per-call without it |
| `TURNSTILE_SECRET_KEY` | `src/utils/verifyCaptcha.js` | Cloudflare Turnstile secret for Q&A comments and the public instructor application form (`POST /submit-instructor`); in production both are rejected without it (skipped outside production) |
| `MAIL_TO` / `MAIL_FROM` | Various controllers (`enrollment`, `enquiry`, `career`, `leadCapture`, `internApplication`) | Admin notification recipient/sender address |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | `src/config/cloudinary.js` | File/image uploads |
| `ANTHROPIC_API_KEY` | `src/services/aiAgent.service.js`, `src/routes/chat.routes.js`, `src/routes/admin.routes.js` | AI agents (recovery emails, lead scoring, chat) |
| `OPENAI_API_KEY` | `src/routes/chat.routes.js` | Alternate chat model path |
| `REDIS_URL` (preferred) or `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `src/config/redis.js` | Bull queues; falls back to `127.0.0.1:6379` if unset |
| `STRIPE_WEBHOOK_SECRET` | `src/index.js` | Stripe webhook signature verification |
| `ENROLLMENT_TOKEN_KEY` | `src/utils/tokenCrypto.js` | Enrollment recovery link token encryption |
| `RESET_TOKEN_SECRET` | `src/utils/resetTokenUtil.js` | Password reset token pepper. Set it in production — without it the pepper is derived from `JWT_SECRET` (and an error is logged) |
| `CONFIRM_DELETE_SECRET` | `src/utils/confirmDelete.js` | Admin destructive-action confirmation |
| `BACKLINK_STRATEGY_DIR` | `src/controllers/seoReport.controller.js` | SEO backlink strategy file location |
| `FRONTEND_URL` | Many (email templates, OAuth redirects, CORS fallback) | Canonical frontend origin |
| `WHITELISTED_URLS` | `src/index.js`, `src/routes/auth.routes.js` | Comma-separated CORS allowlist |
| `CONTENT_FACTORY_SERVICE_KEY` | `src/middleware/requireContentFactoryServiceKey.js` | API key for the unattended weekly trend-research routine (no admin login). Unset → that one route 503s |
| `HANA_ADMIN_TOKEN` | `src/routes/admin.routes.js` | Server-side token for calling the Hana agent's admin API. Must match the Hana service's own `HANA_ADMIN_TOKEN` |
| `CHAT_API_URL` | `src/routes/admin.routes.js` | Hana agent origin, used to refresh its course cache after a catalog write. Needs `HANA_ADMIN_TOKEN` too — if either is missing the refresh is skipped |
| `VERCEL_DEPLOY_HOOK_URL` | `src/routes/admin.routes.js` | Fire-and-forget frontend rebuild after a course-catalog write. Optional; failures are logged, never blocking |
| `TTS_PROVIDER` / `TTS_VOICE` | `src/services/courseFactory/ttsService.js` | Course Factory lesson audio. Fall back to the per-course setting, then `"openai"` / `"alloy"` |

## CRM integrations (optional)

| Variable | Used by | Notes |
|---|---|---|
| `CRM_SETUP_TOKEN` | `src/controllers/crmUser.controller.js` | Enables the one-time `POST /api/crm/auth/setup` owner bootstrap (send it as `setupToken`). Leave unset once the first CRM owner exists — setup is disabled without it |
| `CRM_FROM_EMAIL` | `src/controllers/crmActivity.controller.js` | Sender for emails reps send from the CRM (`POST /api/crm/email/send`), e.g. `Technohana Sales <sales@technohana.in>`; must be on the verified Resend domain. Defaults to the sales address. Replies go to the rep |
| `CRM_DAILY_REPORT_EXTRA_EMAILS` | `src/services/crmDailyReport.js` | Comma-separated extra recipients for the 7pm IST CRM report |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REDIRECT_URI` | `src/config/zohoClient.js` | Zoho Mail + Meeting OAuth (server-based client from api-console.zoho.in). Redirect URI = `<backend>/api/crm/zoho/callback`. Unset → CRM "Connect Zoho" returns 503; email keeps using Resend |
| `ZOHO_MEETING_ENABLED` | `src/config/zohoClient.js` | Set `true` to request Zoho Meeting scopes and enable "Schedule meeting". Needs Zoho Meeting **Professional** (API access is not on the free plan). Default off: Mail only. Reps must reconnect after changing it |
| `ZOHO_MEETING_MAX_MINUTES` | `src/controllers/crmZoho.controller.js` | Longest meeting the CRM will schedule. Default `60` (Zoho Meeting free plan limit) |
| `ZOHO_DC` | `src/config/zohoClient.js` | Zoho data centre suffix, default `in` (accounts.zoho.in). Use `com`, `eu`, etc. for other regions |
| `RESEND_WEBHOOK_SECRET` | `src/services/resendWebhook.js` | Signature verification for Resend email events; also powers CRM email delivery status (delivered/opened/bounced) on the lead timeline. Unset → the webhook **rejects every event with 500**, so all delivery/open/click tracking stops |
| `META_APP_SECRET` | `src/services/metaLeadAds.js` | Meta app secret — verifies `X-Hub-Signature-256` on `/webhooks/meta-leads` and signs Graph calls (`appsecret_proof`) |
| `META_WEBHOOK_VERIFY_TOKEN` | `src/routes/metaWebhook.routes.js` | Any random string; enter the same value as the "Verify token" when subscribing the webhook in the Meta app |
| `META_PAGE_ACCESS_TOKEN` | `src/services/metaLeadAds.js` | Long-lived Page access token with `leads_retrieval` + `pages_manage_metadata`, used to fetch each lead |
| `META_GRAPH_VERSION` | `src/services/metaLeadAds.js` | Graph API version, default `v21.0` |
| `META_AD_ACCOUNT_ID` | `src/services/metaAdInsights.js` | Ad account id (with or without `act_`) — enables spend/clicks on the CRM Ads page and admin UTM report; without it only CRM lead counts show |
| `META_ADS_ACCESS_TOKEN` | `src/services/metaAdInsights.js` | Optional token with `ads_read` (system-user token recommended); falls back to `META_PAGE_ACCESS_TOKEN` |
| `INSTAGRAM_APP_SECRET` | `src/services/metaLeadAds.js` | Instagram app secret (Meta app → Instagram → API setup with Instagram login, top of page → Show). Instagram-login webhooks are signed with it, so `/webhooks/meta-leads` accepts either this or `META_APP_SECRET` |
| `INSTAGRAM_ACCESS_TOKEN` | `src/services/instagramComments.js` | Token from the app's Instagram product (API setup with Instagram login → Generate token) for the `@technohana` account. When set, comment replies and DMs go through `graph.instagram.com` with it; when unset they fall back to `META_PAGE_ACCESS_TOKEN` on `graph.facebook.com`. The backend refreshes it automatically (daily job in `src/services/instagramToken.js`) and keeps the refreshed token encrypted in MongoDB (`integrationtokens`, needs `ENROLLMENT_TOKEN_KEY`); this variable is only the seed — pasting a different token here replaces the stored one. Admins are emailed if refreshing keeps failing |
| `META_CAPI_ENABLED` | `src/services/metaConversions.js` | Set to `true` to send server-side Lead and Purchase events (Meta Conversions API) alongside the browser pixel. Off by default |
| `META_PIXEL_ID` | `src/services/metaConversions.js` | Pixel that receives server-side events; defaults to the business "Technohana Pixel" `1327222791931119` (the one the site fires) |
| `META_CAPI_ACCESS_TOKEN` | `src/services/metaConversions.js` | Token allowed to write to that pixel (needs `ads_management` and access to the pixel); falls back to `META_ADS_ACCESS_TOKEN`, then `META_PAGE_ACCESS_TOKEN` |
| `META_CAPI_TEST_EVENT_CODE` | `src/services/metaConversions.js` | Optional. While set, events show only in Events Manager > Test events and do not count for ads. Remove it to go live |
| `LINKEDIN_CLIENT_ID` | `src/config/linkedinClient.js` | LinkedIn app client id (developer.linkedin.com). Unset → the CRM Integrations LinkedIn card shows "not configured" |
| `LINKEDIN_CLIENT_SECRET` | `src/config/linkedinClient.js` | LinkedIn app client secret |
| `LINKEDIN_REDIRECT_URI` | `src/config/linkedinClient.js` | Must match the app's authorised redirect URL exactly: `https://<api-host>/api/crm/linkedin/callback` |
| `LINKEDIN_API_VERSION` | `src/config/linkedinClient.js` | `LinkedIn-Version` header (YYYYMM), default `202604`. LinkedIn retires versions after about a year; "Requested version … is not active" (HTTP 426) means bump this |
| `LINKEDIN_ORGANIZATION_ID` | `src/services/linkedinPublish.js` | Numeric id of the Technohana LinkedIn page. Enables Social Factory "Publish to LinkedIn"; the connection also needs `w_organization_social` in `LINKEDIN_OAUTH_SCOPES` (Community Management API product) — reconnect in CRM Integrations after adding it |
| `LINKEDIN_LEAD_SYNC_ENABLED` | `src/services/linkedinLeadQueue.js` | Set `true` to poll LinkedIn Lead Gen Form responses every 10 minutes. Unset/false removes the repeatable job. Turn on only after the Lead Sync API product is approved, `r_marketing_leadgen_automation` is in `LINKEDIN_OAUTH_SCOPES` and LinkedIn is reconnected in the CRM; otherwise every run fails with "Not enough permissions" |
| `LINKEDIN_OAUTH_SCOPES` | `src/config/linkedinClient.js` | Space-separated, default `r_ads r_ads_reporting` (needs the Advertising API product). For Lead Gen Form import add `r_marketing_leadgen_automation` once the Lead Sync API product is approved. Requesting a scope the app hasn't been granted makes LinkedIn show "Bummer, something went wrong" |
| `WHATSAPP_TOKEN` | `src/services/whatsapp.js` | Permanent system-user token with `whatsapp_business_messaging`. Unset → sends throw "not configured" |
| `WHATSAPP_PHONE_NUMBER_ID` | `src/services/whatsapp.js` | Phone number ID of the WhatsApp Business number (from Meta → WhatsApp → API setup) |
| `WHATSAPP_OTP_TEMPLATE` | `src/services/whatsapp.js` (`sendLoginCode`) | Name of the approved **Authentication** template with a copy-code button (e.g. `technohana_login_code`). Unset → `/auth/whatsapp/otp` returns 503 |
| `WHATSAPP_OTP_LANG` | `src/services/whatsapp.js` | Language code of that template, default `en` |
| `WHATSAPP_VERIFY_TOKEN` | `src/routes/whatsappWebhook.routes.js` | Verify token for the `/webhooks/whatsapp` subscription; falls back to `META_WEBHOOK_VERIFY_TOKEN`. Webhook signatures use `META_APP_SECRET` |

LinkedIn Ads setup: an admin connects once from CRM → Integrations → LinkedIn Ads (OAuth), picks the ad account, and Lead Gen Form responses are polled every 10 minutes into CRM leads (`source=linkedin_ads`). Tokens are stored encrypted (`ENROLLMENT_TOKEN_KEY`); access tokens last ~60 days and refresh automatically until the refresh token expires (~1 year).

Meta Lead Ads setup: in the Meta app add the Webhooks product → Page → subscribe to `leadgen` with callback `https://<api-host>/webhooks/meta-leads` and the verify token above; subscribe the app to the Page (`POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`). Leads already submitted can be pulled with `node scripts/backfill-meta-leads.js --form <formId> --since YYYY-MM-DD --apply`.

## Admin bootstrap (optional, dev/ops convenience)

| Variable | Used by | Notes |
|---|---|---|
| `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` | `src/controllers/adminUser.controller.js` | Bootstrap admin account credentials |
| `SALES_EMAIL` / `SALES_PASSWORD_HASH` | `src/controllers/adminUser.controller.js` | Bootstrap sales account credentials |
| `ALLOW_ADMIN_SETUP` | `src/routes/admin.routes.js` | Gates the one-time admin-setup endpoint |

## Development-only

| Variable | Used by | Notes |
|---|---|---|
| `NODE_ENV` | `src/index.js` | `production` tightens CORS (origin required) and silences `debug`-level logs (`src/utils/logger.js`) |
| `PORT` | `src/index.js` | Defaults to `3000`; Railway sets this automatically in deployment |

## Dead config — set in `.env` but never read by `src/`

Safe to delete. Listed so they don't get copied into a production environment and
create false confidence that a feature is configured when nothing reads the value.

| Variable | Why it's dead |
|---|---|
| `ADMIN_PASSWORD` | Superseded by `ADMIN_PASSWORD_HASH`; the plaintext form is never read |
| `CLOUDINARY_NAME` | Real var is `CLOUDINARY_CLOUD_NAME` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Superseded by Resend; no SMTP transport remains in `src/` |
| `SOCIAL_WEBHOOK_URL` | No reader in `src/` |
| `EXPO_PUBLIC_API_BASE_URL` | Belongs to `technohana-mobile`, not this service |

## Naming traps

`STRIPE_WEBHOOK_SECRET` is the name the code reads (`src/index.js`, Stripe webhook
handler). A `.env` defining `STRIPE_WEBHOOKS` instead leaves `endpointSecret` undefined, so
`stripe.webhooks.constructEvent` throws and **every** webhook returns 400 — payment
confirmations never process, with no startup warning. This exact mistake was present in the
local `.env` until 2026-09-28; check any deployed environment configured from the same list.

## Notes

- `CLAUDE.md`'s existing env list is the "day-to-day" quick reference; this file is the exhaustive audit trail. If they drift, update both.
- Never commit `.env` files or log raw secret values — see `src/utils/logger.js` and the "Sensitive logging" guidance in this sprint's Production Polish Report.
