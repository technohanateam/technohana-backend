/**
 * Meta's Graph API is inconsistent about the `act_` prefix: ad-account-scoped
 * endpoints require it in the URL path, but nested object fields like
 * Campaign.account_id and AdSet.account_id return the bare numeric ID. This
 * codebase always carries the `act_` prefix internally so callers never have
 * to remember which form a given field uses.
 */
export function normalizeAccountId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}
