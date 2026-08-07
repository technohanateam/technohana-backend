# Meta + LinkedIn Ads MCP Server

A production-ready Remote MCP Server that lets Claude fully manage a Meta (Facebook & Instagram) Ads account **and** a LinkedIn Ads account — campaigns, creatives, budgets, targeting, insights, leads, and AI-assisted copywriting/recommendations/reporting for both platforms — over the Model Context Protocol's Streamable HTTP transport.

Standalone Node.js/TypeScript service, independent of anything else in this repository. See [`docs/architecture.md`](./docs/architecture.md) for the component-level design, [`docs/mcp-tools.md`](./docs/mcp-tools.md) for the full 106-tool reference, and [`docs/sequence-diagrams.md`](./docs/sequence-diagrams.md) for the OAuth/tool-call/bulk-operation flows.

## Features

- **106 MCP tools** — 47 for Meta (everything from `list_ad_accounts` to `bulk_create_ads`) and 59 for LinkedIn (every `linkedin_`-prefixed tool, from `linkedin_list_organizations` to `linkedin_creative_score`) — see [the full reference](./docs/mcp-tools.md).
- **Two independent OAuth flows** — Meta OAuth with automatic long-lived token refresh across multiple Business Managers, and LinkedIn OAuth 2.0 with genuine refresh-token rotation across multiple administered organizations. Connect either or both.
- **Role-based access control** — four tiers (viewer/analyst/advertiser/admin) enforced per tool on both platforms, with an append-only audit log for every mutating call.
- **AI-assisted tools grounded in real data** — budget/bid recommendations and reports pull actual Ads Insights/Analytics before asking Claude for a number; `campaign_health_score` (and LinkedIn's `creative_score`) compute their score deterministically and only use AI for the narrative.
- **Swappable storage & cache** — file (default), Redis, MongoDB, or PostgreSQL for storage; in-memory or Redis for caching. Config change, not a code change.
- **Bulk operations** with bounded concurrency and per-item success/failure reporting, never all-or-nothing.
- **Retries + backoff** for transient API errors on both platforms (LinkedIn's honoring `Retry-After`), clean classification of expired-token/permission/validation errors.
- **Observability**: Prometheus `/metrics` (per-platform API latency and rate-limit counters), OpenTelemetry tracing (optional), Sentry error reporting (optional).
- **110 automated tests** (Vitest + Supertest + MSW) exercising the real Express/MCP/provider stack end-to-end, both platforms' APIs mocked.

## Prerequisites

- Node.js 22+
- A [Meta App](https://developers.facebook.com/apps) with the **Marketing API** product added, and/or a [LinkedIn Developer App](https://www.linkedin.com/developers/apps) with **Marketing Developer Platform** access (see [`docs/linkedin-setup.md`](./docs/linkedin-setup.md)) — connect either platform independently, or both
- One of: nothing extra (default file storage) · Redis · MongoDB · PostgreSQL, if you want a different storage/cache backend
- An [Anthropic API key](https://console.anthropic.com/) for the AI-assisted tools (optional — everything else works without it)

## 1. Create and configure the Meta App

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App** → choose **Business** as the app type.
2. Add the **Marketing API** product to the app.
3. Under **App Settings → Basic**, note your **App ID** and **App Secret**.
4. Under **Marketing API → Settings** (or **Facebook Login → Settings**), add a valid OAuth redirect URI — this must exactly match `META_OAUTH_REDIRECT_URI` below (e.g. `http://localhost:3333/auth/meta/callback` for local dev, `https://yourdomain.com/auth/meta/callback` in production).
5. Request the permissions this server uses by default: `ads_management`, `ads_read`, `business_management`, `leads_retrieval`, `pages_show_list`. For personal/development use these work in Development Mode with your own account added as a tester; broader access to other people's ad accounts requires Meta's **App Review** and, for some permissions, **Business Verification** — both are Meta processes outside this codebase, budget real time for them if you intend to go beyond your own accounts.
6. If you'll manage ad accounts inside a Business Manager, make sure your Meta user is added to that Business Manager with appropriate admin/advertiser access — the OAuth flow discovers every Business Manager you belong to automatically.

## 1b. Create and configure the LinkedIn App (optional)

Only needed if you want the `linkedin_*` tools. Full walkthrough (Marketing Developer Platform access request, required scopes, ad account access) is in [`docs/linkedin-setup.md`](./docs/linkedin-setup.md) — short version: create an app at [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps), request the **Marketing Developer Platform** product, note the **Client ID**/**Client Secret**, and add an OAuth redirect URL matching `LINKEDIN_OAUTH_REDIRECT_URI` below.

## 2. Install and configure

```bash
cd meta-ads-mcp-server
npm install
cp .env.example .env
```

Fill in `.env`. At minimum:

```bash
MCP_JWT_SECRET=$(openssl rand -hex 32)          # paste into MCP_JWT_SECRET
FILE_STORE_ENCRYPTION_KEY=$(openssl rand -hex 32)  # paste into FILE_STORE_ENCRYPTION_KEY (default file storage)
```

Then set `META_APP_ID`, `META_APP_SECRET`, and `META_OAUTH_REDIRECT_URI` from step 1 (Meta), and/or `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_OAUTH_REDIRECT_URI` from step 1b (LinkedIn) — both platforms' credentials are required by env validation at startup even if you only plan to use one; set the unused platform's App/Client ID and Secret to any non-empty placeholder if you're intentionally skipping it. `ANTHROPIC_API_KEY` is needed only for the `generate_*`/`recommend_*`/`campaign_health_score`/`*_report`/`linkedin_generate_*`/`linkedin_recommend_*`/`linkedin_*_report` tools — everything else works without it.

Every variable is documented inline in [`.env.example`](./.env.example): server config, storage/cache backend selection, rate limiting, bulk-operation limits, and observability toggles.

## 3. Run it locally

```bash
npm run dev          # http://localhost:3333, auto-reload
```

Check it's alive:

```bash
curl http://localhost:3333/live      # {"success":true,"status":"alive"}
curl http://localhost:3333/ready     # storage + Meta API reachability
```

## 4. Connect a Meta and/or LinkedIn account

**Meta**: open `http://localhost:3333/auth/meta/login` in a browser and complete Meta's authorization prompt. On success:

```json
{
  "success": true,
  "connections": [{ "key": "1234567890", "businessName": "Acme Inc." }]
}
```

That `key` is the `connectionKey` value you'll pass to Meta MCP tools (or omit it entirely if you only ever connect one account — it resolves automatically). If you have no Business Manager, you'll get a single connection with `"key": "personal"` instead.

**LinkedIn**: open `http://localhost:3333/auth/linkedin/login` and complete LinkedIn's authorization prompt. On success:

```json
{
  "success": true,
  "connections": [{ "key": "urn:li:organization:12345", "organizationName": "Acme Inc." }]
}
```

Same idea — that `key` (an organization URN) is the `connectionKey` for `linkedin_*` tools. See [`docs/linkedin-setup.md`](./docs/linkedin-setup.md) for the full walkthrough and troubleshooting.

## 5. Connect it to Claude

Claude's Remote MCP Connector needs a bearer token for the `/mcp` endpoint. This server doesn't implement dynamic OAuth client registration — it's built for a single operator, so you mint your own long-lived token once:

```bash
# Set a long TTL for a token you'll paste into Claude and keep using
# (the .env default of 3600s/1hr is sized for short-lived tokens, not this).
MCP_JWT_TTL_SECONDS=31536000 npm run issue-token -- --role admin --sub claude-connector
```

This prints a JWT. In Claude, go to **Settings → Connectors → Add custom connector**, and configure:

- **URL**: `https://yourdomain.com/mcp` (or `http://localhost:3333/mcp` for local testing via a tunnel)
- **Authentication**: Bearer Token → paste the token printed above

`--role` controls what the token can do (see the [RBAC tiers](./docs/mcp-tools.md) — `viewer`/`analyst`/`advertiser`/`admin`); issue a lower-privilege token if you don't want that Claude session able to spend money or run bulk operations.

## Running tests

```bash
npm test              # run once
npm run test:watch    # watch mode
npm run test:coverage # with coverage
```

110 tests across unit (FileStore, MemoryCache, AI JSON-repair logic, deterministic health scoring for both platforms, LinkedIn token refresh/error classification) and integration suites (full OAuth flow for both platforms, MCP handshake + RBAC, campaign creation, creatives/media, audience/budget, insights/lead gen, error/retry handling) — all driving the real Express/MCP/provider stack via Supertest, with only the Meta Graph API and LinkedIn Marketing API themselves mocked (MSW). No real network calls happen in the test suite.

## Docker

```bash
docker build -t meta-ads-mcp-server .
docker run --env-file .env -p 3333:3333 meta-ads-mcp-server
```

Or with Compose (default profile runs just the app against file storage/memory cache):

```bash
docker compose up
```

To run against Redis/MongoDB/PostgreSQL instead, activate the matching profile and point the app at it via `.env` (`STORAGE_BACKEND=redis`, etc.):

```bash
docker compose --profile redis up
docker compose --profile mongo up
docker compose --profile postgres up
docker compose --profile full up      # all three backends available at once
```

## Deployment

The service is a standard Node.js HTTP server (`npm run build && npm start`) with no deploy-target-specific code, so any of these work:

- **Railway** — connect the repo, set the root directory to `meta-ads-mcp-server/`, set env vars in the dashboard, Railway auto-detects the Dockerfile.
- **Render** — new Web Service, root directory `meta-ads-mcp-server/`, "Docker" runtime (uses the included `Dockerfile`), set env vars.
- **Azure App Service** — deploy the container (`az webapp create --deployment-container-image-name ...`) or use Azure's Node.js runtime with `npm run build` as the build command and `npm start` as startup.
- **AWS ECS** — build and push the image to ECR, run as a Fargate task; put secrets in AWS Secrets Manager / SSM Parameter Store and inject as env vars rather than baking them into the image.
- **Plain Docker anywhere** — `docker build . && docker run --env-file .env -p 3333:3333 <image>`.

Whichever platform you use:

- Set `NODE_ENV=production`.
- Update `META_OAUTH_REDIRECT_URI` to your real domain, and add that exact URI to the Meta App's allowed OAuth redirect URIs.
- If you're not using the default file storage, provision Redis/MongoDB/PostgreSQL and set `STORAGE_BACKEND`/`STORAGE_*_URL` accordingly — file storage works for a single always-on instance but won't survive an ephemeral filesystem or scale past one replica.
- Point your platform's health check at `GET /live` and readiness check at `GET /ready`.

## Observability

- **Metrics**: `GET /metrics` (Prometheus text format) when `METRICS_ENABLED=true` (default). Exposes tool invocation counts/latency by tool name and status, Meta and LinkedIn API call latency, and rate-limit-retry counts for both platforms, plus Node's default process metrics.
- **Tracing**: set `OTEL_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT`. Auto-instrumentation is preloaded via `node --import ./dist/observability/register.js` (already wired into `npm start` and the Dockerfile's `CMD`) — this is required in an ESM project, since instrumentation can't patch a module (like `express`) that's already been imported.
- **Errors**: set `SENTRY_DSN` to enable Sentry. Only genuinely unexpected errors are reported — a denied-permission or an expected Meta validation error is not treated as an incident.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Server won't start, "Invalid environment configuration" | A required env var is missing — the error lists exactly which ones. |
| Every `/mcp` call returns 401 | Token expired, wrong `MCP_JWT_SECRET`, or you're using a token issued with the default 1-hour TTL — reissue with a longer `MCP_JWT_TTL_SECONDS`. |
| A tool call returns `isError: true` with a permission message | The bearer token's role doesn't cover that tool — check [the RBAC tier](./docs/mcp-tools.md) and reissue a token with a higher role if appropriate. |
| A tool call fails with "No Meta connection found" | You haven't completed `/auth/meta/login` yet, or passed the wrong `connectionKey`. |
| A tool call fails with "Multiple Meta connections are stored" | You have more than one connected Business Manager — pass `connectionKey` explicitly. |
| A `linkedin_*` tool call fails with "No LinkedIn connection found" | You haven't completed `/auth/linkedin/login` yet, or passed the wrong `connectionKey`. |
| A `linkedin_*` tool call fails with "Multiple LinkedIn connections are stored" | You administer more than one LinkedIn organization — pass `connectionKey` explicitly. |
| `/ready` returns 503 | Either the configured storage backend, the Meta Graph API, or the LinkedIn Marketing API is unreachable — check the `checks` object in the response body. |
| Meta API errors about invalid/expired token | Long-lived tokens last ~60 days; the server refreshes automatically ~3 days before expiry, but if the server was offline past that window, redo `/auth/meta/login`. |
| LinkedIn API errors about invalid/expired token | Access tokens last ~60 days and refresh automatically via the stored refresh token ~3 days before expiry; if the refresh token itself expired (~365 days) or was never issued, redo `/auth/linkedin/login`. See [`docs/linkedin-setup.md`](./docs/linkedin-setup.md) for more LinkedIn-specific troubleshooting. |
| Docker build fails to pull the base image | Some sandboxed/restricted network environments block Docker Hub entirely — this succeeds in normal CI/local environments with standard registry access. |

## License

Not licensed for external distribution — internal use within this repository's context.
