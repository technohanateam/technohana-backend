import { LINKEDIN_CACHE_NAMESPACES, LINKEDIN_CACHE_TTL_SECONDS } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/linkedinTokenManager.js';
import { linkedinClient } from './client.js';
import { campaignGroupUrn, idFromUrn } from './urn.util.js';
import type {
  CreateCampaignGroupInput,
  LinkedInCampaignGroup,
  LinkedInCampaignGroupStatus,
  UpdateCampaignGroupInput,
} from '../../types/linkedin.types.js';

interface RawCampaignGroup {
  id: number;
  account: string;
  name: string;
  status: LinkedInCampaignGroupStatus;
  totalBudget?: { amount: string; currencyCode: string };
  runSchedule?: { start: number; end?: number };
}

interface RawCampaignGroupsResponse {
  elements: RawCampaignGroup[];
}

function mapCampaignGroup(raw: RawCampaignGroup): LinkedInCampaignGroup {
  return {
    urn: campaignGroupUrn(String(raw.id)),
    id: String(raw.id),
    accountUrn: raw.account,
    name: raw.name,
    status: raw.status,
    totalBudgetAmount: raw.totalBudget ? Number(raw.totalBudget.amount) : undefined,
    totalBudgetCurrency: raw.totalBudget?.currencyCode,
    runSchedule: raw.runSchedule
      ? { start: new Date(raw.runSchedule.start).toISOString(), end: raw.runSchedule.end ? new Date(raw.runSchedule.end).toISOString() : undefined }
      : undefined,
  };
}

function toEpochMs(iso: string): number {
  return new Date(iso).getTime();
}

async function invalidateCampaignGroupListCache(accountUrn: string): Promise<void> {
  await getCacheAdapter().invalidate(LINKEDIN_CACHE_NAMESPACES.CAMPAIGN_METADATA, `group-list:${accountUrn}`);
}

export async function getCampaignGroup(connectionKey: string, urn: string): Promise<LinkedInCampaignGroup> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawCampaignGroup>(`/adCampaignGroups/${idFromUrn(urn)}`, {
    accessToken,
    operationName: 'getCampaignGroup',
  });
  return mapCampaignGroup(result.data);
}

export async function listCampaignGroups(connectionKey: string, accountUrn: string): Promise<LinkedInCampaignGroup[]> {
  const cache = getCacheAdapter();
  const cacheKey = `group-list:${accountUrn}`;
  const cached = await cache.get<LinkedInCampaignGroup[]>(LINKEDIN_CACHE_NAMESPACES.CAMPAIGN_METADATA, cacheKey);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawCampaignGroupsResponse>('/adCampaignGroups', {
    accessToken,
    operationName: 'listCampaignGroups',
    params: { q: 'search', 'search.account.values[0]': accountUrn },
  });

  const groups = result.data.elements.map(mapCampaignGroup);
  await cache.set(LINKEDIN_CACHE_NAMESPACES.CAMPAIGN_METADATA, cacheKey, groups, LINKEDIN_CACHE_TTL_SECONDS[LINKEDIN_CACHE_NAMESPACES.CAMPAIGN_METADATA]);
  return groups;
}

export async function createCampaignGroup(connectionKey: string, input: CreateCampaignGroupInput): Promise<LinkedInCampaignGroup> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.post<unknown>('/adCampaignGroups', {
    accessToken,
    operationName: 'createCampaignGroup',
    body: {
      account: input.accountUrn,
      name: input.name,
      status: input.status ?? 'DRAFT',
      totalBudget:
        input.totalBudgetAmount !== undefined
          ? { amount: String(input.totalBudgetAmount), currencyCode: input.totalBudgetCurrency ?? 'USD' }
          : undefined,
      runSchedule: input.runSchedule
        ? { start: toEpochMs(input.runSchedule.start), end: input.runSchedule.end ? toEpochMs(input.runSchedule.end) : undefined }
        : undefined,
    },
  });

  if (!result.restliId) {
    throw new Error('LinkedIn did not return an ID for the newly-created campaign group.');
  }

  await invalidateCampaignGroupListCache(input.accountUrn);
  return getCampaignGroup(connectionKey, campaignGroupUrn(result.restliId));
}

export async function updateCampaignGroup(
  connectionKey: string,
  urn: string,
  input: UpdateCampaignGroupInput,
): Promise<LinkedInCampaignGroup> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const existing = await getCampaignGroup(connectionKey, urn);

  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.status !== undefined) set.status = input.status;
  if (input.totalBudgetAmount !== undefined) {
    set.totalBudget = { amount: String(input.totalBudgetAmount), currencyCode: existing.totalBudgetCurrency ?? 'USD' };
  }
  if (input.runSchedule !== undefined) {
    set.runSchedule = { start: toEpochMs(input.runSchedule.start), end: input.runSchedule.end ? toEpochMs(input.runSchedule.end) : undefined };
  }

  await linkedinClient.patch(`/adCampaignGroups/${idFromUrn(urn)}`, {
    accessToken,
    operationName: 'updateCampaignGroup',
    patch: { patch: { $set: set } },
  });

  await invalidateCampaignGroupListCache(existing.accountUrn);
  return getCampaignGroup(connectionKey, urn);
}

export async function archiveCampaignGroup(connectionKey: string, urn: string): Promise<LinkedInCampaignGroup> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const existing = await getCampaignGroup(connectionKey, urn);

  await linkedinClient.patch(`/adCampaignGroups/${idFromUrn(urn)}`, {
    accessToken,
    operationName: 'archiveCampaignGroup',
    patch: { patch: { $set: { status: 'ARCHIVED' } } },
  });

  await invalidateCampaignGroupListCache(existing.accountUrn);
  return getCampaignGroup(connectionKey, urn);
}
