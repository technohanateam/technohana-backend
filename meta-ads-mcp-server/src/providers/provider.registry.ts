import type { AdProvider } from '../types/provider.types.js';

const providers = new Map<string, AdProvider>();

/** Registers an AdProvider implementation under its `name`. Called once at startup. */
export function registerProvider(provider: AdProvider): void {
  providers.set(provider.name, provider);
}

/**
 * Resolves the active AdProvider by name (defaults to 'meta', the only provider
 * shipped today). Adding another platform later means implementing AdProvider
 * and calling registerProvider() for it — no changes needed to the MCP tool layer.
 */
export function getProvider(name = 'meta'): AdProvider {
  const provider = providers.get(name);
  if (!provider) {
    const available = [...providers.keys()].join(', ') || 'none';
    throw new Error(`No ad provider registered for '${name}'. Registered providers: ${available}`);
  }
  return provider;
}

export function listRegisteredProviders(): string[] {
  return [...providers.keys()];
}
