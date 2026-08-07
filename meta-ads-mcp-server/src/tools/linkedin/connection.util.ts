import { getDefaultConnectionKey } from '../../auth/linkedinTokenManager.js';

/** Resolves an explicit connectionKey, or falls back to the single stored LinkedIn connection. */
export async function resolveLinkedInConnectionKey(explicit: string | undefined): Promise<string> {
  return explicit ?? getDefaultConnectionKey();
}
