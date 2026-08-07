import { LINKEDIN_CACHE_NAMESPACES, LINKEDIN_CACHE_TTL_SECONDS } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/linkedinTokenManager.js';
import { linkedinClient } from './client.js';
import { accountUrn, idFromUrn } from './urn.util.js';
import type { LinkedInAdAccount } from '../../types/linkedin.types.js';

interface RawAdAccount {
  id: number;
  name: string;
  status: LinkedInAdAccount['status'];
  type: LinkedInAdAccount['type'];
  currency: string;
  /** URN of the owning organization for BUSINESS accounts; absent for personal accounts. */
  reference?: string;
}

interface RawAdAccountsResponse {
  elements: RawAdAccount[];
}

function mapAdAccount(raw: RawAdAccount): LinkedInAdAccount {
  return {
    urn: accountUrn(String(raw.id)),
    id: String(raw.id),
    name: raw.name,
    organizationUrn: raw.reference,
    currency: raw.currency,
    status: raw.status,
    type: raw.type,
  };
}

/** Lists ad accounts visible to the connection, optionally scoped to those owned by one organization. */
export async function listAdAccounts(connectionKey: string, organizationUrn?: string): Promise<LinkedInAdAccount[]> {
  const cache = getCacheAdapter();
  const cacheKey = `${connectionKey}:${organizationUrn ?? 'all'}`;
  const cached = await cache.get<LinkedInAdAccount[]>(LINKEDIN_CACHE_NAMESPACES.AD_ACCOUNTS, cacheKey);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawAdAccountsResponse>('/adAccounts', {
    accessToken,
    operationName: 'listAdAccounts',
    params: {
      q: 'search',
      ...(organizationUrn ? { 'search.reference.values[0]': organizationUrn } : {}),
    },
  });

  const accounts = result.data.elements.map(mapAdAccount);
  await cache.set(LINKEDIN_CACHE_NAMESPACES.AD_ACCOUNTS, cacheKey, accounts, LINKEDIN_CACHE_TTL_SECONDS[LINKEDIN_CACHE_NAMESPACES.AD_ACCOUNTS]);
  return accounts;
}

export async function getAdAccount(connectionKey: string, urn: string): Promise<LinkedInAdAccount> {
  const cache = getCacheAdapter();
  const cached = await cache.get<LinkedInAdAccount>(LINKEDIN_CACHE_NAMESPACES.AD_ACCOUNTS, urn);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawAdAccount>(`/adAccounts/${idFromUrn(urn)}`, {
    accessToken,
    operationName: 'getAdAccount',
  });

  const account = mapAdAccount(result.data);
  await cache.set(LINKEDIN_CACHE_NAMESPACES.AD_ACCOUNTS, urn, account, LINKEDIN_CACHE_TTL_SECONDS[LINKEDIN_CACHE_NAMESPACES.AD_ACCOUNTS]);
  return account;
}
