# LinkedIn Ads Setup

How to create a LinkedIn Developer App, get Marketing API access, and
configure this server to connect to it. Do this alongside (not instead of)
the Meta setup in the main [README.md](../README.md) — the two are
independent and both live in this one server.

## 1. Create a LinkedIn Developer App

1. Go to [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) → **Create app**.
2. Fill in app name, associate it with a LinkedIn Company Page you administer (LinkedIn requires every app to be linked to a Page — this can be the same organization you'll advertise for, or a dedicated "developer" page), and accept the API terms.
3. Under **Products**, request **Marketing Developer Platform**. This is the product that unlocks the Marketing API (campaigns, creatives, analytics, lead gen). Approval is not always instant — LinkedIn reviews access requests, and broader access (beyond your own ad accounts) can require additional justification. Budget real time for this; it's a LinkedIn process outside this codebase.
4. Under **Auth**, note the **Client ID** and **Client Secret** — these become `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`.
5. Under **Auth → OAuth 2.0 settings**, add an **Authorized redirect URL** that exactly matches `LINKEDIN_OAUTH_REDIRECT_URI` below (e.g. `http://localhost:3333/auth/linkedin/callback` for local dev, `https://yourdomain.com/auth/linkedin/callback` in production).

## 2. Required OAuth scopes

Once Marketing Developer Platform is approved, request these scopes for the app (`LINKEDIN_OAUTH_SCOPES`, space-separated, matches the `.env.example` default):

| Scope | Used for |
|---|---|
| `r_ads` | Reading campaigns, campaign groups, creatives, ad accounts |
| `rw_ads` | Creating/updating campaigns, campaign groups, creatives, budgets, targeting |
| `r_ads_reporting` | Analytics (`linkedin_campaign_insights` and the per-metric tools) |
| `r_organization_admin` | Discovering which organizations you administer (`linkedin_list_organizations`) |
| `r_organization_social` | Organization metadata (`linkedin_get_organization`) |

LinkedIn also issues a **refresh token** alongside the access token when your
app has offline access — `linkedinTokenManager.ts` uses it to renew the
access token automatically (~3 days before its ~60-day expiry) without
requiring you to redo the OAuth dialog. If the refresh token itself expires
(~365 days) or was never granted, `getFreshAccessToken` fails clearly and
tells you to reconnect via `/auth/linkedin/login`.

## 3. Ensure your account has ad account access

The OAuth flow discovers every organization you administer
(`organizationAcls?role=ADMINISTRATOR`) and stores one connection per
organization — the same multi-connection pattern the Meta flow uses for
Business Managers. If your LinkedIn member account has no organization admin
role, a single `"personal"` connection is stored instead. Either way, make
sure the connected LinkedIn account has **admin or campaign manager access**
on the ad account(s) you want Claude to manage — separate from Page admin
access, this is set in [LinkedIn Campaign Manager](https://www.linkedin.com/campaignmanager/) under **Account Access**.

## 4. Configure and connect

Same flow as the Meta setup — fill in `.env`:

```bash
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
LINKEDIN_OAUTH_REDIRECT_URI=http://localhost:3333/auth/linkedin/callback
```

Then, with the server running, open `http://localhost:3333/auth/linkedin/login`
in a browser and complete LinkedIn's authorization prompt. On success:

```json
{
  "success": true,
  "connections": [{ "key": "urn:li:organization:12345", "organizationName": "Acme Inc." }]
}
```

That `key` (an organization URN) is the `connectionKey` value you pass to
`linkedin_*` MCP tools — or omit it entirely if you only ever connect one
organization, it resolves automatically.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| A `linkedin_*` tool call fails with "No LinkedIn connection found" | You haven't completed `/auth/linkedin/login` yet, or passed the wrong `connectionKey`. |
| A tool call fails with "Multiple LinkedIn connections are stored" | You administer more than one organization — pass `connectionKey` explicitly. |
| A tool call fails with "...has expired and no refresh token is stored" | Your app wasn't granted offline access, or the refresh token itself expired (~365 days) — redo `/auth/linkedin/login`. |
| `linkedin_list_organizations` returns an empty list | Your LinkedIn member account doesn't administer any organization — you'll get a `"personal"` connection instead, and account-level tools (`linkedin_list_ad_accounts`, etc.) still work against ad accounts shared with you directly. |
| API calls return 403 | Marketing Developer Platform access isn't approved yet, or the requested scope isn't granted — check the app's **Products** and **Auth** tabs. |
| API calls return 429 repeatedly | LinkedIn's rate limits are being hit — the client already retries with backoff honoring `Retry-After`, but sustained 429s mean you're over your app's daily throttle limit. |
