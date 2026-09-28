# Environment Variables Reference

Audited against actual `process.env.*` usage in `src/` (re-audited 2026-09-28). Supersedes the shorter list in `CLAUDE.md`, which is kept as the quick-reference subset.

## Required

Missing any of these causes the server to fail fast on startup (see `src/index.js`, "Startup Config Validation").

| Variable | Used by | Purpose |
|---|---|---|
| `MONGO_DB` | `src/config/db.js` | MongoDB connection string |
| `JWT_SECRET` | `src/config/jwt.js`, `src/middleware/authenticateInstructor.js`, `src/routes/instructor.routes.js` | User/instructor auth token signing |
| `ADMIN_JWT_SECRET` | `src/middleware/authenticateAdmin.js`, `src/controllers/adminUser.controller.js`, `src/controllers/seoConnection.controller.js` | Admin auth token signing |
| `STRIPE_SECRET` | `src/index.js` | Stripe SDK init (international payments) |

## Optional — feature degrades gracefully or has a fallback if unset

| Variable | Used by | Notes |
|---|---|---|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | `src/index.js` | India/INR payments; Razorpay-specific endpoints will fail without them, rest of the app is unaffected |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `BASE_URL` | `src/config/passport.js` | Google OAuth login |
| `SEO_GOOGLE_CLIENT_ID` / `SEO_GOOGLE_CLIENT_SECRET` / `SEO_GOOGLE_REDIRECT_URI` | `src/config/googleSeoOAuth.js` | Search Console/GA4 OAuth connect flow (SEO Intelligence admin) |
| `GA4_PROPERTY_ID` / `GOOGLE_SERVICE_ACCOUNT_KEY` | `src/config/googleAnalytics.js` | GA4 Key Events admin panel |
| `RESEND_API_KEY` | `src/config/emailService.js` and callers | Transactional email; sends will fail silently-per-call without it |
| `MAIL_TO` / `MAIL_FROM` | Various controllers (`enrollment`, `enquiry`, `career`, `leadCapture`, `internApplication`) | Admin notification recipient/sender address |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | `src/config/cloudinary.js` | File/image uploads |
| `ANTHROPIC_API_KEY` | `src/services/aiAgent.service.js`, `src/routes/chat.routes.js`, `src/routes/admin.routes.js` | AI agents (recovery emails, lead scoring, chat) |
| `OPENAI_API_KEY` | `src/routes/chat.routes.js` | Alternate chat model path |
| `REDIS_URL` (preferred) or `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `src/config/redis.js` | Bull queues; falls back to `127.0.0.1:6379` if unset |
| `STRIPE_WEBHOOK_SECRET` | `src/index.js` | Stripe webhook signature verification |
| `ENROLLMENT_TOKEN_KEY` | `src/utils/tokenCrypto.js` | Enrollment recovery link token encryption |
| `RESET_TOKEN_SECRET` | `src/utils/resetTokenUtil.js` | Password reset tokens |
| `CONFIRM_DELETE_SECRET` | `src/utils/confirmDelete.js` | Admin destructive-action confirmation |
| `BACKLINK_STRATEGY_DIR` | `src/controllers/seoReport.controller.js` | SEO backlink strategy file location |
| `FRONTEND_URL` | Many (email templates, OAuth redirects, CORS fallback) | Canonical frontend origin |
| `WHITELISTED_URLS` | `src/index.js`, `src/routes/auth.routes.js` | Comma-separated CORS allowlist |
| `RESEND_WEBHOOK_SECRET` | `src/services/resendWebhook.js` | Signature verification for Resend email events. Unset → the webhook **rejects every event with 500**, so delivery/open/click tracking stops |
| `CONTENT_FACTORY_SERVICE_KEY` | `src/middleware/requireContentFactoryServiceKey.js` | API key for the unattended weekly trend-research routine (no admin login). Unset → that one route 503s |
| `HANA_ADMIN_TOKEN` | `src/routes/admin.routes.js` | Server-side token for calling the Hana agent's admin API. Must match the Hana service's own `HANA_ADMIN_TOKEN` |
| `CHAT_API_URL` | `src/routes/admin.routes.js` | Hana agent origin, used to refresh its course cache after a catalog write. Needs `HANA_ADMIN_TOKEN` set too — if either is missing the refresh is skipped silently |
| `VERCEL_DEPLOY_HOOK_URL` | `src/routes/admin.routes.js` | Fire-and-forget frontend rebuild after a course-catalog write. Optional; failures are logged, never blocking |
| `TTS_PROVIDER` / `TTS_VOICE` | `src/services/courseFactory/ttsService.js` | Course Factory lesson audio. `TTS_VOICE` falls back to the per-course setting, then `"alloy"` |

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

`STRIPE_WEBHOOK_SECRET` is the name the code reads ([`src/index.js`](src/index.js), Stripe webhook
handler). A `.env` defining `STRIPE_WEBHOOKS` instead leaves `endpointSecret` undefined, so
`stripe.webhooks.constructEvent` throws and **every** webhook returns 400 — payment
confirmations never process, with no startup warning (it is not in `REQUIRED_ENV_VARS`).
`STRIPE_WEBHOOKS` is a known wrong spelling that has appeared in real environment files —
verify the exact name whenever provisioning or auditing a deployment.

## Notes

- `CLAUDE.md`'s existing env list is the "day-to-day" quick reference; this file is the exhaustive audit trail. If they drift, update both.
- Never commit `.env` files or log raw secret values — see `src/utils/logger.js` and the "Sensitive logging" guidance in this sprint's Production Polish Report.
