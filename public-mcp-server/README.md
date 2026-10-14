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

- Install: `npm ci && npm ci --prefix public-mcp-server`
- Start: `node public-mcp-server/server.js`
- Healthcheck: `/health`
- Env: `MONGO_DB_READONLY` (required), `PORT`. Nothing else; no JWT, Stripe, CRM or admin secrets.
- Mongo user: read-only on the `Course` and `Coupon` collections only. The server connects with `autoIndex` and `autoCreate` off. `search_courses` needs the text index that the main backend already creates.

## Limits

60 requests/min per IP overall; requests that include a coupon code are limited to 10 per 15 minutes per IP. Request bodies are capped at 16 KB.

## Not yet verified

Not run against a real MongoDB, MCP Inspector, or Claude as a custom connector. Tests use an in-memory emulation of the two models.
