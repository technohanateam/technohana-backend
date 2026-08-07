import { LINKEDIN_CACHE_NAMESPACES, LINKEDIN_CACHE_TTL_SECONDS } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/linkedinTokenManager.js';
import { linkedinClient } from './client.js';
import { campaignUrn, idFromUrn } from './urn.util.js';
import type {
  CreateCampaignInput,
  LinkedInAudienceTargeting,
  LinkedInCampaign,
  LinkedInCampaignStatus,
  UpdateCampaignInput,
} from '../../types/linkedin.types.js';
import type {
  LinkedInCampaignCostType,
  LinkedInCampaignObjective,
  LinkedInCampaignType,
} from '../../config/constants.js';

interface RawCampaign {
  id: number;
  account: string;
  campaignGroup: string;
  name: string;
  objectiveType: LinkedInCampaignObjective;
  type: LinkedInCampaignType;
  status: LinkedInCampaignStatus;
  costType: LinkedInCampaignCostType;
  dailyBudget?: { amount: string; currencyCode: string };
  totalBudget?: { amount: string; currencyCode: string };
  unitCost?: { amount: string; currencyCode: string };
  targetingCriteria?: LinkedInAudienceTargeting;
  runSchedule?: { start: number; end?: number };
  createdAt: number;
  lastModifiedAt: number;
}

interface RawCampaignsResponse {
  elements: RawCampaign[];
}

function mapCampaign(raw: RawCampaign): LinkedInCampaign {
  const currency = raw.dailyBudget?.currencyCode ?? raw.totalBudget?.currencyCode ?? raw.unitCost?.currencyCode ?? 'USD';
  return {
    urn: campaignUrn(String(raw.id)),
    id: String(raw.id),
    accountUrn: raw.account,
    campaignGroupUrn: raw.campaignGroup,
    name: raw.name,
    objectiveType: raw.objectiveType,
    type: raw.type,
    status: raw.status,
    costType: raw.costType,
    dailyBudgetAmount: raw.dailyBudget ? Number(raw.dailyBudget.amount) : undefined,
    totalBudgetAmount: raw.totalBudget ? Number(raw.totalBudget.amount) : undefined,
    unitCostAmount: raw.unitCost ? Number(raw.unitCost.amount) : undefined,
    currency,
    targeting: raw.targetingCriteria,
    runSchedule: raw.runSchedule
      ? { start: new Date(raw.runSchedule.start).toISOString(), end: raw.runSchedule.end ? new Date(raw.runSchedule.end).toISOString() : undefined }
      : undefined,
    createdAt: new Date(raw.createdAt).toISOString(),
    lastModifiedAt: new Date(raw.lastModifiedAt).toISOString(),
  };
}

function toEpochMs(iso: string): number {
  return new Date(iso).getTime();
}

async function invalidateCampaignListCache(accountUrn: string): Promise<void> {
  await getCacheAdapter().invalidate(LINKEDIN_CACHE_NAMESPACES.CAMPAIGN_METADATA, `campaign-list:${accountUrn}`);
}

export async function getCampaign(connectionKey: string, urn: string): Promise<LinkedInCampaign> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawCampaign>(`/adCampaigns/${idFromUrn(urn)}`, {
    accessToken,
    operationName: 'getCampaign',
  });
  return mapCampaign(result.data);
}

export async function listCampaigns(
  connectionKey: string,
  accountUrn: string,
  campaignGroupUrnFilter?: string,
): Promise<LinkedInCampaign[]> {
  const cache = getCacheAdapter();
  const cacheKey = `campaign-list:${accountUrn}${campaignGroupUrnFilter ? `:${campaignGroupUrnFilter}` : ''}`;
  const cached = await cache.get<LinkedInCampaign[]>(LINKEDIN_CACHE_NAMESPACES.CAMPAIGN_METADATA, cacheKey);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawCampaignsResponse>('/adCampaigns', {
    accessToken,
    operationName: 'listCampaigns',
    params: {
      q: 'search',
      'search.account.values[0]': accountUrn,
      ...(campaignGroupUrnFilter ? { 'search.campaignGroup.values[0]': campaignGroupUrnFilter } : {}),
    },
  });

  const campaigns = result.data.elements.map(mapCampaign);
  await cache.set(LINKEDIN_CACHE_NAMESPACES.CAMPAIGN_METADATA, cacheKey, campaigns, LINKEDIN_CACHE_TTL_SECONDS[LINKEDIN_CACHE_NAMESPACES.CAMPAIGN_METADATA]);
  return campaigns;
}

function buildBudgetFields(input: {
  dailyBudgetAmount?: number;
  totalBudgetAmount?: number;
  unitCostAmount?: number;
  currency: string;
}): Record<string, unknown> {
  return {
    dailyBudget: input.dailyBudgetAmount !== undefined ? { amount: String(input.dailyBudgetAmount), currencyCode: input.currency } : undefined,
    totalBudget: input.totalBudgetAmount !== undefined ? { amount: String(input.totalBudgetAmount), currencyCode: input.currency } : undefined,
    unitCost: input.unitCostAmount !== undefined ? { amount: String(input.unitCostAmount), currencyCode: input.currency } : undefined,
  };
}

export async function createCampaign(connectionKey: string, input: CreateCampaignInput): Promise<LinkedInCampaign> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.post<unknown>('/adCampaigns', {
    accessToken,
    operationName: 'createCampaign',
    body: {
      account: input.accountUrn,
      campaignGroup: input.campaignGroupUrn,
      name: input.name,
      objectiveType: input.objectiveType,
      type: input.type,
      costType: input.costType,
      status: input.status ?? 'DRAFT',
      ...buildBudgetFields(input),
      targetingCriteria: input.targeting,
      runSchedule: input.runSchedule
        ? { start: toEpochMs(input.runSchedule.start), end: input.runSchedule.end ? toEpochMs(input.runSchedule.end) : undefined }
        : undefined,
    },
  });

  if (!result.restliId) {
    throw new Error('LinkedIn did not return an ID for the newly-created campaign.');
  }

  await invalidateCampaignListCache(input.accountUrn);
  return getCampaign(connectionKey, campaignUrn(result.restliId));
}

/** Duplicates an existing campaign (same objective/type/cost structure/targeting) under a new name. The duplicate is created DRAFT. */
export async function duplicateCampaign(connectionKey: string, urn: string, newName: string): Promise<LinkedInCampaign> {
  const existing = await getCampaign(connectionKey, urn);
  return createCampaign(connectionKey, {
    accountUrn: existing.accountUrn,
    campaignGroupUrn: existing.campaignGroupUrn,
    name: newName,
    objectiveType: existing.objectiveType,
    type: existing.type,
    costType: existing.costType,
    status: 'DRAFT',
    dailyBudgetAmount: existing.dailyBudgetAmount,
    totalBudgetAmount: existing.totalBudgetAmount,
    unitCostAmount: existing.unitCostAmount,
    currency: existing.currency,
    targeting: existing.targeting,
    runSchedule: existing.runSchedule,
  });
}

async function setCampaignStatus(
  connectionKey: string,
  urn: string,
  status: Extract<LinkedInCampaignStatus, 'ACTIVE' | 'PAUSED' | 'ARCHIVED'>,
): Promise<LinkedInCampaign> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const existing = await getCampaign(connectionKey, urn);

  await linkedinClient.patch(`/adCampaigns/${idFromUrn(urn)}`, {
    accessToken,
    operationName: 'setCampaignStatus',
    patch: { patch: { $set: { status } } },
  });

  await invalidateCampaignListCache(existing.accountUrn);
  return getCampaign(connectionKey, urn);
}

export async function pauseCampaign(connectionKey: string, urn: string): Promise<LinkedInCampaign> {
  return setCampaignStatus(connectionKey, urn, 'PAUSED');
}

export async function resumeCampaign(connectionKey: string, urn: string): Promise<LinkedInCampaign> {
  return setCampaignStatus(connectionKey, urn, 'ACTIVE');
}

export async function archiveCampaign(connectionKey: string, urn: string): Promise<LinkedInCampaign> {
  return setCampaignStatus(connectionKey, urn, 'ARCHIVED');
}

export async function updateCampaign(connectionKey: string, urn: string, input: UpdateCampaignInput): Promise<LinkedInCampaign> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const existing = await getCampaign(connectionKey, urn);

  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.status !== undefined) set.status = input.status;
  if (input.dailyBudgetAmount !== undefined) set.dailyBudget = { amount: String(input.dailyBudgetAmount), currencyCode: existing.currency };
  if (input.totalBudgetAmount !== undefined) set.totalBudget = { amount: String(input.totalBudgetAmount), currencyCode: existing.currency };
  if (input.unitCostAmount !== undefined) set.unitCost = { amount: String(input.unitCostAmount), currencyCode: existing.currency };
  if (input.targeting !== undefined) set.targetingCriteria = input.targeting;
  if (input.runSchedule !== undefined) {
    set.runSchedule = { start: toEpochMs(input.runSchedule.start), end: input.runSchedule.end ? toEpochMs(input.runSchedule.end) : undefined };
  }

  await linkedinClient.patch(`/adCampaigns/${idFromUrn(urn)}`, {
    accessToken,
    operationName: 'updateCampaign',
    patch: { patch: { $set: set } },
  });

  await invalidateCampaignListCache(existing.accountUrn);
  return getCampaign(connectionKey, urn);
}
