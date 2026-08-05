import { getDefaultConnectionKey } from '../auth/tokenManager.js';

/** Resolves an explicit connectionKey, or falls back to the single stored connection. */
export async function resolveConnectionKey(explicit: string | undefined): Promise<string> {
  return explicit ?? getDefaultConnectionKey();
}
