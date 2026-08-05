# LinkedIn Ads provider (not implemented)

This directory is an extension point, not a stub implementation. No fake
`LinkedInProvider` class ships here on purpose: a class that throws
`"not implemented"` on every method would violate this project's own
no-placeholder-code standard, and there are no LinkedIn Marketing API
credentials, scopes, or requested tools in the current build to implement
against.

## How to add LinkedIn Ads support later

1. Implement `AdProvider` (see `src/types/provider.types.ts`) in a new
   `linkedin.provider.ts` here, backed by real LinkedIn Marketing API calls —
   follow the same pattern as `src/providers/meta/meta.provider.ts`: one
   `*.service.ts` file per domain (campaign groups, campaigns, creatives,
   analytics, lead gen forms), each function taking a `connectionKey` first
   argument that resolves to a stored OAuth token via a LinkedIn-specific
   token manager.
2. Register it once at startup:
   ```ts
   import { linkedinProvider } from './providers/linkedin/linkedin.provider.js';
   registerProvider(linkedinProvider);
   ```
3. No changes are needed to `src/tools/*` or the MCP tool registry — they call
   `getProvider(name)` from `src/providers/provider.registry.ts`, so a second
   registered provider is immediately usable by any tool that accepts a
   `provider` parameter.
