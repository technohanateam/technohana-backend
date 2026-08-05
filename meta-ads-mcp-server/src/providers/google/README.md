# Google Ads provider (not implemented)

This directory is an extension point, not a stub implementation. No fake
`GoogleProvider` class ships here on purpose: a class that throws
`"not implemented"` on every method would violate this project's own
no-placeholder-code standard, and there are no Google Ads credentials, scopes,
or requested tools in the current build to implement against.

## How to add Google Ads support later

1. Implement `AdProvider` (see `src/types/provider.types.ts`) in a new
   `google.provider.ts` here, backed by real Google Ads API (v17+) calls —
   follow the same pattern as `src/providers/meta/meta.provider.ts`: one
   `*.service.ts` file per domain (campaigns, ad groups, ads, insights, etc.),
   each function taking a `connectionKey` first argument that resolves to a
   stored OAuth token via a Google-specific token manager.
2. Register it once at startup:
   ```ts
   import { googleProvider } from './providers/google/google.provider.js';
   registerProvider(googleProvider);
   ```
3. No changes are needed to `src/tools/*` or the MCP tool registry — they call
   `getProvider(name)` from `src/providers/provider.registry.ts`, so a second
   registered provider is immediately usable by any tool that accepts a
   `provider` parameter.
