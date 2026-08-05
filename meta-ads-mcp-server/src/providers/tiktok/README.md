# TikTok Ads provider (not implemented)

This directory is an extension point, not a stub implementation. No fake
`TikTokProvider` class ships here on purpose: a class that throws
`"not implemented"` on every method would violate this project's own
no-placeholder-code standard, and there are no TikTok for Business API
credentials, scopes, or requested tools in the current build to implement
against.

## How to add TikTok Ads support later

1. Implement `AdProvider` (see `src/types/provider.types.ts`) in a new
   `tiktok.provider.ts` here, backed by real TikTok Marketing API calls —
   follow the same pattern as `src/providers/meta/meta.provider.ts`: one
   `*.service.ts` file per domain (campaigns, ad groups, ads, reporting),
   each function taking a `connectionKey` first argument that resolves to a
   stored OAuth token via a TikTok-specific token manager.
2. Register it once at startup:
   ```ts
   import { tiktokProvider } from './providers/tiktok/tiktok.provider.js';
   registerProvider(tiktokProvider);
   ```
3. No changes are needed to `src/tools/*` or the MCP tool registry — they call
   `getProvider(name)` from `src/providers/provider.registry.ts`, so a second
   registered provider is immediately usable by any tool that accepts a
   `provider` parameter.
