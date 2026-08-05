import { getFreshAccessToken } from '../../auth/tokenManager.js';
import { metaClient } from './client.js';
import { normalizeAccountId } from './accountId.util.js';
import { createAdCreative } from './creatives.service.js';
import type { CreateAdInput, MetaAd, MetaCampaignStatus } from '../../types/meta.types.js';

const AD_FIELDS = 'id,account_id,adset_id,campaign_id,name,status,creative,created_time,updated_time';

interface RawAd {
  id: string;
  account_id: string;
  adset_id: string;
  campaign_id: string;
  name: string;
  status: MetaCampaignStatus;
  creative?: { id: string };
  created_time: string;
  updated_time: string;
}

function mapAd(raw: RawAd): MetaAd {
  return {
    id: raw.id,
    accountId: normalizeAccountId(raw.account_id),
    adSetId: raw.adset_id,
    campaignId: raw.campaign_id,
    name: raw.name,
    status: raw.status,
    creativeId: raw.creative?.id ?? '',
    createdTime: raw.created_time,
    updatedTime: raw.updated_time,
  };
}

export async function getAd(connectionKey: string, adId: string): Promise<MetaAd> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<RawAd>(`/${adId}`, {
    accessToken,
    operationName: 'getAd',
    params: { fields: AD_FIELDS },
  });
  return mapAd(result.data);
}

export async function listAds(connectionKey: string, adSetId: string): Promise<MetaAd[]> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<{ data: RawAd[] }>(`/${adSetId}/ads`, {
    accessToken,
    operationName: 'listAds',
    params: { fields: AD_FIELDS, limit: 200 },
  });
  return result.data.data.map(mapAd);
}

/** Creates the ad's creative first, then the ad referencing it. */
export async function createAd(connectionKey: string, input: CreateAdInput): Promise<MetaAd> {
  const creativeId = await createAdCreative(connectionKey, input.creative);
  const accessToken = await getFreshAccessToken(connectionKey);
  const accountId = normalizeAccountId(input.accountId);

  const result = await metaClient.post<{ id: string }>(`/${accountId}/ads`, {
    accessToken,
    operationName: 'createAd',
    body: {
      name: input.name,
      adset_id: input.adSetId,
      status: input.status ?? 'PAUSED',
      creative: { creative_id: creativeId },
    },
  });

  return getAd(connectionKey, result.data.id);
}
