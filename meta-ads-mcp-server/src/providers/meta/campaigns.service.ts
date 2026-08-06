import { CACHE_NAMESPACES, CACHE_TTL_SECONDS } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/tokenManager.js';
import { metaClient } from './client.js';
import { normalizeAccountId } from './accountId.util.js';
import type { CreateCampaignInput, MetaCampaign, MetaCampaignStatus } from '../../types/meta.types.js';
import type { MetaCampaignObjective } from '../../config/constants.js';

const CAMPAIGN_FIELDS =
  'id,account_id,name,objective,status,daily_budget,lifetime_budget,bid_strategy,created_time,updated_time';

interface RawCampaign {
  id: string;
  account_id: string;
  name: string;
  objective: MetaCampaignObjective;
  status: MetaCampaignStatus;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  created_time: string;
  updated_time: string;
}

function mapCampaign(raw: RawCampaign): MetaCampaign {
  return {
    id: raw.id,
    accountId: normalizeAccountId(raw.account_id),
    name: raw.name,
    objective: raw.objective,
    status: raw.status,
    dailyBudgetCents: raw.daily_budget ? Number(raw.daily_budget) : undefined,
    lifetimeBudgetCents: raw.lifetime_budget ? Number(raw.lifetime_budget) : undefined,
    bidStrategy: raw.bid_strategy as MetaCampaign['bidStrategy'],
    createdTime: raw.created_time,
    updatedTime: raw.updated_time,
  };
}

async function invalidateCampaignListCache(accountId: string): Promise<void> {
  await getCacheAdapter().invalidate(CACHE_NAMESPACES.CAMPAIGN_METADATA, normalizeAccountId(accountId));
}

export async function getCampaign(connectionKey: string, campaignId: string): Promise<MetaCampaign> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<RawCampaign>(`/${campaignId}`, {
    accessToken,
    operationName: 'getCampaign',
    params: { fields: CAMPAIGN_FIELDS },
  });
  return mapCampaign(result.data);
}

export async function listCampaigns(connectionKey: string, accountId: string): Promise<MetaCampaign[]> {
  const cache = getCacheAdapter();
  const normalizedAccountId = normalizeAccountId(accountId);
  const cached = await cache.get<MetaCampaign[]>(CACHE_NAMESPACES.CAMPAIGN_METADATA, normalizedAccountId);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<{ data: RawCampaign[] }>(`/${normalizedAccountId}/campaigns`, {
    accessToken,
    operationName: 'listCampaigns',
    params: { fields: CAMPAIGN_FIELDS, limit: 200 },
  });

  const campaigns = result.data.data.map(mapCampaign);
  await cache.set(
    CACHE_NAMESPACES.CAMPAIGN_METADATA,
    normalizedAccountId,
    campaigns,
    CACHE_TTL_SECONDS[CACHE_NAMESPACES.CAMPAIGN_METADATA],
  );
  return campaigns;
}

export async function createCampaign(connectionKey: string, input: CreateCampaignInput): Promise<MetaCampaign> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const accountId = normalizeAccountId(input.accountId);

  const result = await metaClient.post<{ id: string }>(`/${accountId}/campaigns`, {
    accessToken,
    operationName: 'createCampaign',
    body: {
      name: input.name,
      objective: input.objective,
      status: input.status ?? 'PAUSED',
      special_ad_categories: input.specialAdCategories ?? [],
      daily_budget: input.dailyBudgetCents,
      lifetime_budget: input.lifetimeBudgetCents,
      bid_strategy: input.bidStrategy,
    },
  });

  await invalidateCampaignListCache(accountId);
  return getCampaign(connectionKey, result.data.id);
}

export async function duplicateCampaign(
  connectionKey: string,
  campaignId: string,
  newName: string,
): Promise<MetaCampaign> {
  const existing = await getCampaign(connectionKey, campaignId);
  return createCampaign(connectionKey, {
    accountId: existing.accountId,
    name: newName,
    objective: existing.objective,
    status: 'PAUSED',
    dailyBudgetCents: existing.dailyBudgetCents,
    lifetimeBudgetCents: existing.lifetimeBudgetCents,
    bidStrategy: existing.bidStrategy,
  });
}

async function setCampaignStatus(
  connectionKey: string,
  campaignId: string,
  status: Extract<MetaCampaignStatus, 'ACTIVE' | 'PAUSED'>,
): Promise<MetaCampaign> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const existing = await getCampaign(connectionKey, campaignId);
  await metaClient.post<{ success: boolean }>(`/${campaignId}`, {
    accessToken,
    operationName: 'setCampaignStatus',
    body: { status },
  });
  await invalidateCampaignListCache(existing.accountId);
  return getCampaign(connectionKey, campaignId);
}

export async function pauseCampaign(connectionKey: string, campaignId: string): Promise<MetaCampaign> {
  return setCampaignStatus(connectionKey, campaignId, 'PAUSED');
}

export async function resumeCampaign(connectionKey: string, campaignId: string): Promise<MetaCampaign> {
  return setCampaignStatus(connectionKey, campaignId, 'ACTIVE');
}

export async function deleteCampaign(connectionKey: string, campaignId: string): Promise<void> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const existing = await getCampaign(connectionKey, campaignId);
  await metaClient.del<{ success: boolean }>(`/${campaignId}`, { accessToken, operationName: 'deleteCampaign' });
  await invalidateCampaignListCache(existing.accountId);
}

export async function updateCampaignBudget(
  connectionKey: string,
  campaignId: string,
  budget: { dailyBudgetCents?: number; lifetimeBudgetCents?: number },
): Promise<MetaCampaign> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const existing = await getCampaign(connectionKey, campaignId);
  await metaClient.post<{ success: boolean }>(`/${campaignId}`, {
    accessToken,
    operationName: 'updateCampaignBudget',
    body: {
      daily_budget: budget.dailyBudgetCents,
      lifetime_budget: budget.lifetimeBudgetCents,
    },
  });
  await invalidateCampaignListCache(existing.accountId);
  return getCampaign(connectionKey, campaignId);
}
