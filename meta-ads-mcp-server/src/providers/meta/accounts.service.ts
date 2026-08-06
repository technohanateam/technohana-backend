import { CACHE_NAMESPACES, CACHE_TTL_SECONDS } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/tokenManager.js';
import { metaClient } from './client.js';
import type { MetaAdAccount, MetaBusiness } from '../../types/meta.types.js';

const AD_ACCOUNT_FIELDS = 'id,account_id,name,business,currency,timezone_name,account_status';
const BUSINESS_FIELDS = 'id,name,verification_status';

interface RawAdAccount {
  id: string;
  account_id: string;
  name: string;
  business?: { id: string; name: string };
  currency: string;
  timezone_name: string;
  account_status: number;
}

interface RawBusiness {
  id: string;
  name: string;
  verification_status?: string;
}

function mapAdAccount(raw: RawAdAccount): MetaAdAccount {
  return {
    id: raw.id,
    accountId: raw.account_id,
    name: raw.name,
    businessId: raw.business?.id,
    businessName: raw.business?.name,
    currency: raw.currency,
    timezoneName: raw.timezone_name,
    accountStatus: raw.account_status,
  };
}

function mapBusiness(raw: RawBusiness): MetaBusiness {
  return { id: raw.id, name: raw.name, verificationStatus: raw.verification_status };
}

/** Lists ad accounts visible to the connection, optionally scoped to one Business Manager. */
export async function listAdAccounts(connectionKey: string, businessId?: string): Promise<MetaAdAccount[]> {
  const cache = getCacheAdapter();
  const cacheKey = `${connectionKey}:${businessId ?? 'all'}`;
  const cached = await cache.get<MetaAdAccount[]>(CACHE_NAMESPACES.AD_ACCOUNTS, cacheKey);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const path = businessId ? `/${businessId}/owned_ad_accounts` : '/me/adaccounts';
  const result = await metaClient.get<{ data: RawAdAccount[] }>(path, {
    accessToken,
    operationName: 'listAdAccounts',
    params: { fields: AD_ACCOUNT_FIELDS, limit: 200 },
  });

  const accounts = result.data.data.map(mapAdAccount);
  await cache.set(CACHE_NAMESPACES.AD_ACCOUNTS, cacheKey, accounts, CACHE_TTL_SECONDS[CACHE_NAMESPACES.AD_ACCOUNTS]);
  return accounts;
}

/** Lists Business Manager accounts visible to the connection. */
export async function listBusinesses(connectionKey: string): Promise<MetaBusiness[]> {
  const cache = getCacheAdapter();
  const cached = await cache.get<MetaBusiness[]>(CACHE_NAMESPACES.BUSINESSES, connectionKey);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<{ data: RawBusiness[] }>('/me/businesses', {
    accessToken,
    operationName: 'listBusinesses',
    params: { fields: BUSINESS_FIELDS, limit: 200 },
  });

  const businesses = result.data.data.map(mapBusiness);
  await cache.set(CACHE_NAMESPACES.BUSINESSES, connectionKey, businesses, CACHE_TTL_SECONDS[CACHE_NAMESPACES.BUSINESSES]);
  return businesses;
}
