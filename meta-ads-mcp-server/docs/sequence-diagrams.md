# Sequence Diagrams

## 1. Meta OAuth connection flow

The operator visits `/auth/meta/login` once (in a browser, not via Claude) to connect their Meta account. This mints the `connectionKey` value(s) later passed into MCP tool calls.

```mermaid
sequenceDiagram
    actor Operator
    participant Server as meta-ads-mcp-server
    participant Meta as Meta Graph API

    Operator->>Server: GET /auth/meta/login
    Server->>Server: mint signed, time-boxed state (auth/oauth.ts)
    Server-->>Operator: 302 redirect to Meta OAuth dialog

    Operator->>Meta: authorizes the app (Meta's own UI)
    Meta-->>Operator: 302 redirect to /auth/meta/callback?code=...&state=...

    Operator->>Server: GET /auth/meta/callback?code&state
    Server->>Server: verify state signature + freshness (10 min TTL)
    Server->>Meta: GET /oauth/access_token (exchange code, short-lived token)
    Meta-->>Server: short-lived access_token
    Server->>Meta: GET /oauth/access_token (grant_type=fb_exchange_token)
    Meta-->>Server: long-lived access_token (~60 days)
    Server->>Meta: GET /me
    Meta-->>Server: Meta user id/name
    Server->>Meta: GET /me/businesses
    Meta-->>Server: Business Manager list
    Server->>Server: storeToken() per business<br/>(or one 'personal' record if none) via StorageAdapter
    Server-->>Operator: 200 { connections: [{ key, businessName }] }

    Note over Operator,Server: `key` is what you pass as connectionKey<br/>in MCP tool calls
```

## 2. MCP tool-call flow (Claude → Meta API)

```mermaid
sequenceDiagram
    actor Claude
    participant Server as server.ts
    participant Auth as requireBearerAuth<br/>+ mcpTokenVerifier
    participant Mcp as mcp.ts (McpServer)
    participant Tool as tools/*.ts<br/>(via createTool.ts)
    participant Provider as providers/meta/*.service.ts
    participant Cache
    participant Token as auth/tokenManager.ts
    participant Meta as Meta Graph API

    Claude->>Server: POST /mcp { method: "initialize" }<br/>Authorization: Bearer <jwt>
    Server->>Auth: verify JWT
    Auth-->>Server: AuthInfo { userId, role, expiresAt }
    Server->>Mcp: createSessionTransport + createMcpServer()
    Mcp-->>Claude: 200 + Mcp-Session-Id header

    Claude->>Server: POST /mcp { method: "tools/call",<br/>params: { name: "list_campaigns", arguments } }<br/>Mcp-Session-Id: <id>
    Server->>Auth: verify JWT (every call)
    Server->>Mcp: route to session transport
    Mcp->>Mcp: Zod-validate tool input (SDK-level, before handler runs)
    Mcp->>Tool: handler(args, context)
    Tool->>Tool: assertToolPermission(role, "list_campaigns")
    alt role lacks permission
        Tool-->>Claude: isError: true, "Role '...' is not permitted..."
    else permitted
        Tool->>Provider: listCampaigns(connectionKey, accountId)
        Provider->>Cache: get(campaign-metadata, accountId)
        alt cache hit
            Cache-->>Provider: cached MetaCampaign[]
        else cache miss
            Provider->>Token: getFreshAccessToken(connectionKey)
            Token-->>Provider: access token (refreshed if near expiry)
            Provider->>Meta: GET /{accountId}/campaigns<br/>(retried on transient errors, utils/retry.ts)
            Meta-->>Provider: campaign data
            Provider->>Cache: set(campaign-metadata, accountId, ..., ttl)
        end
        Provider-->>Tool: MetaCampaign[]
        Tool-->>Mcp: MCP text-content result
        Mcp-->>Claude: 200 tools/call result
        Note over Tool: metrics + structured log recorded either way<br/>(observability/metrics.ts, utils/logger.ts)
    end
```

## 3. Bulk operation flow

`bulk_pause_campaigns` shown; `bulk_resume_campaigns`, `bulk_update_budgets`, `bulk_update_target_audience`, and `bulk_create_ads` all follow the same shape (`tools/bulk.util.ts`).

```mermaid
sequenceDiagram
    actor Claude
    participant Tool as bulk_pause_campaigns
    participant Bulk as runBulk() (p-limit, concurrency 5)
    participant Provider as campaigns.service.ts
    participant Meta as Meta Graph API

    Claude->>Tool: tools/call { campaignIds: [c1, c2, c3] }
    Tool->>Tool: assertToolPermission(role, "bulk_pause_campaigns")<br/>(admin tier)
    Tool->>Bulk: runBulk([c1, c2, c3], pauseCampaign)

    par up to 5 concurrent
        Bulk->>Provider: pauseCampaign(connectionKey, c1)
        Provider->>Meta: POST /c1 { status: PAUSED }
        Meta-->>Provider: updated campaign
        Provider-->>Bulk: success
    and
        Bulk->>Provider: pauseCampaign(connectionKey, c2)
        Provider->>Meta: POST /c2 { status: PAUSED }
        Meta-->>Provider: 400 { error: { code: 100, message: "campaign not found" } }
        Provider-->>Bulk: throws MetaApiError
        Note over Bulk: failure captured per-item,<br/>does not abort the batch
    and
        Bulk->>Provider: pauseCampaign(connectionKey, c3)
        Provider->>Meta: POST /c3 { status: PAUSED }
        Meta-->>Provider: updated campaign
        Provider-->>Bulk: success
    end

    Bulk-->>Tool: { total: 3, succeeded: 2, failed: 1, items: [...] }
    Tool-->>Claude: 200, isError: false<br/>(the JSON body itself carries the per-item outcome)
```

See [architecture.md](./architecture.md) for the component-level view and [mcp-tools.md](./mcp-tools.md) for the full tool reference.
