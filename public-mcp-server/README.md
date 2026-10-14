# Technohana public MCP server

Read-only remote MCP server for the public course catalogue and USD price quotes. Separate from `meta-ads-mcp-server` (internal ads management): no shared code, secrets, domain or tool registry.

## Tools

| Tool | Purpose |
|---|---|
| `search_courses` | Keyword / category / difficulty search, max 20 results |
| `get_course_details` | Public details for one course (id or slug) |
| `get_price_quote` | USD price for one learner, optional coupon |
| `get_group_quote` | USD price for 2-50 learners (15% / 25% / 35% tiers), optional coupon |

All tools are annotated `readOnlyHint: true`, `destructiveHint: false`. Quotes use `computeQuote` from `../src/utils/pricing.js` (group discount, then coupon, 50% floor). Referral codes are not supported. Courses whose id starts with `playbook-` are never returned or quoted.

Transport: stateless Streamable HTTP, `POST /mcp` only. `GET /health` for the platform healthcheck.

## Run locally

```bash
# from technohana-backend-master/
npm install                       # shared deps (mongoose etc. resolve from here)
cd public-mcp-server && npm install
MONGO_DB_READONLY=<uri> npm start # http://localhost:3400/mcp
npm test                          # no database needed
```

`mongoose` must resolve from the backend's root `node_modules` (do not install it here), otherwise the models and `connect()` would use different instances.

## Deploy (separate Railway service, same repo)

The repo root `railway.json` starts the main backend, and config-as-code overrides dashboard settings, so this service must use its own config file.

- Source: this repo, branch `master`. Root Directory stays empty (the code imports `../src/...`).
- Settings -> Config-as-code path: `/public-mcp-server/railway.json`. It sets the build command (`npm ci --prefix public-mcp-server`), start command (`node public-mcp-server/server.js`), healthcheck (`/health`) and watch paths (this folder plus `src/utils/pricing.js` and the Course/Coupon models it imports).
- Env: `MONGO_DB_READONLY` (required). `PORT` is injected by Railway. Optional `NODE_VERSION=22`. Nothing else; no JWT, Stripe, CRM or admin secrets.
- Networking: generate a domain; the MCP endpoint is `https://<domain>/mcp`.
- Mongo user: Atlas custom role with only the `find` action on the `courses` and `coupons` collections. Put the database name explicitly in the connection string. The server connects with `autoIndex` and `autoCreate` off. `search_courses` needs the text index that the main backend already creates.

## Limits

60 requests/min per IP overall; requests that include a coupon code are limited to 10 per 15 minutes per IP. Request bodies are capped at 16 KB.

## Not yet verified

Not run against a real MongoDB, MCP Inspector, or Claude as a custom connector. Tests use an in-memory emulation of the two models.
