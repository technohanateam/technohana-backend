# LinkedIn Ads provider

Implemented. This directory holds the LinkedIn Marketing API domain services
that back the `linkedin_*` MCP tools (`src/tools/linkedin/*.tools.ts`):

| File | Responsibility |
|---|---|
| `client.ts` | Retrying, error-normalizing HTTP client for the LinkedIn REST API (`LinkedIn-Version` header, `Retry-After`-aware backoff) |
| `urn.util.ts` | URN ↔ bare-ID helpers (LinkedIn paths take bare IDs; payloads/params use full URNs) |
| `organizations.service.ts`, `accounts.service.ts` | Organizations and ad accounts |
| `campaignGroups.service.ts`, `campaigns.service.ts` | Campaign groups and campaigns (CRUD, pause/resume/archive, duplicate) |
| `creatives.service.ts`, `media.service.ts` | Ad creatives (single image/video/carousel) and image/video asset upload |
| `audience.service.ts`, `budget.service.ts` | Audience estimation/targeting and budget/bid updates |
| `insights.service.ts` | LinkedIn Ads Analytics (impressions/clicks/spend/CTR/CPC/CPM/CPL/leads/conversions/ROAS) |
| `leadgen.service.ts` | Lead Gen Forms, lead retrieval/download, lead statistics |

`src/services/linkedinCopy.service.ts`, `linkedinRecommendation.service.ts`,
and `linkedinReporting.service.ts` hold the Claude-assisted layer (ad copy,
budget/bid/targeting recommendations, campaign health score, reports,
creative score) — same "deterministic score, AI narrates" design as the Meta
AI tools.

## Why this doesn't implement the shared `AdProvider` interface

`types/provider.types.ts`'s `AdProvider` is shaped around Meta's
Account → Campaign → AdSet → Ad hierarchy. LinkedIn's domain model
(Organization → Ad Account → Campaign Group → Campaign → Creative, plus
native Lead Gen Forms) doesn't map onto it without distortion, so LinkedIn
gets its own `LinkedInAdProvider` contract in
`types/linkedin-provider.types.ts` instead. `tools/linkedin/*.tools.ts` call
the domain services directly — the same way `tools/campaigns.tools.ts`
already calls `metaProvider` directly rather than going through
`provider.registry.ts`'s `getProvider()`. Neither provider is actually
registered via `registerProvider()` today; the registry is a documented
extension point for a future tool that needs to resolve a provider generically
by name, not something either provider's own tools depend on.

## OAuth, tokens, and setup

See `auth/linkedinOauth.ts` / `auth/linkedinTokenManager.ts` for the 3-legged
OAuth 2.0 + refresh-token flow, and
[`docs/linkedin-setup.md`](../../docs/linkedin-setup.md) for creating a
LinkedIn Developer App, requesting Marketing Developer Platform access, and
configuring the required environment variables.
