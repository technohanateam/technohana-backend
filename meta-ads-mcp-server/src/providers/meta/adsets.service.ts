import { getFreshAccessToken } from '../../auth/tokenManager.js';
import { metaClient } from './client.js';
import { normalizeAccountId } from './accountId.util.js';
import type { CreateAdSetInput, MetaAdSet, MetaCampaignStatus, MetaTargeting } from '../../types/meta.types.js';

const AD_SET_FIELDS =
  'id,campaign_id,account_id,name,status,daily_budget,lifetime_budget,billing_event,optimization_goal,targeting,start_time,end_time';

interface RawGeoLocations {
  countries?: string[];
  regions?: Array<{ key: string }>;
  cities?: Array<{ key: string; radius?: number; distance_unit?: string }>;
}

interface RawTargeting {
  geo_locations?: RawGeoLocations;
  age_min?: number;
  age_max?: number;
  genders?: number[];
  interests?: Array<{ id: string; name?: string }>;
  behaviors?: Array<{ id: string; name?: string }>;
  custom_audiences?: Array<{ id: string }>;
  excluded_custom_audiences?: Array<{ id: string }>;
  /** Meta's targeting spec uses numeric locale IDs here, not ISO language codes. */
  locales?: number[];
  publisher_platforms?: string[];
}

interface RawAdSet {
  id: string;
  campaign_id: string;
  account_id: string;
  name: string;
  status: MetaCampaignStatus;
  daily_budget?: string;
  lifetime_budget?: string;
  billing_event: string;
  optimization_goal: string;
  targeting?: RawTargeting;
  start_time?: string;
  end_time?: string;
}

/**
 * `MetaTargeting.languages[].key` is expected to hold the numeric Meta locale ID
 * (as a string) for the target language, e.g. "6" for US English - Meta's
 * `locales` targeting field is a list of integer locale IDs, not ISO 639 codes.
 */
function mapTargetingToGraph(targeting: MetaTargeting): RawTargeting {
  return {
    geo_locations: targeting.geoLocations
      ? {
          countries: targeting.geoLocations.countries,
          regions: targeting.geoLocations.regions,
          cities: targeting.geoLocations.cities?.map((city) => ({
            key: city.key,
            radius: city.radius,
            distance_unit: city.distanceUnit,
          })),
        }
      : undefined,
    age_min: targeting.ageMin,
    age_max: targeting.ageMax,
    genders: targeting.genders,
    interests: targeting.interests,
    behaviors: targeting.behaviors,
    custom_audiences: targeting.customAudiences,
    excluded_custom_audiences: targeting.excludedCustomAudiences,
    locales: targeting.languages
      ?.map((lang) => Number(lang.key))
      .filter((code) => !Number.isNaN(code)),
    publisher_platforms: targeting.publisherPlatforms,
  };
}

function mapTargetingFromGraph(raw: RawTargeting | undefined): MetaTargeting {
  if (!raw) return {};
  return {
    geoLocations: raw.geo_locations
      ? {
          countries: raw.geo_locations.countries,
          regions: raw.geo_locations.regions,
          cities: raw.geo_locations.cities?.map((city) => ({
            key: city.key,
            radius: city.radius,
            distanceUnit: city.distance_unit as 'mile' | 'kilometer' | undefined,
          })),
        }
      : undefined,
    ageMin: raw.age_min,
    ageMax: raw.age_max,
    genders: raw.genders as Array<1 | 2> | undefined,
    interests: raw.interests,
    behaviors: raw.behaviors,
    customAudiences: raw.custom_audiences,
    excludedCustomAudiences: raw.excluded_custom_audiences,
    languages: raw.locales?.map((code) => ({ key: String(code) })),
    publisherPlatforms: raw.publisher_platforms as MetaTargeting['publisherPlatforms'],
  };
}

function mapAdSet(raw: RawAdSet): MetaAdSet {
  return {
    id: raw.id,
    campaignId: raw.campaign_id,
    accountId: normalizeAccountId(raw.account_id),
    name: raw.name,
    status: raw.status,
    dailyBudgetCents: raw.daily_budget ? Number(raw.daily_budget) : undefined,
    lifetimeBudgetCents: raw.lifetime_budget ? Number(raw.lifetime_budget) : undefined,
    billingEvent: raw.billing_event,
    optimizationGoal: raw.optimization_goal,
    targeting: mapTargetingFromGraph(raw.targeting),
    startTime: raw.start_time,
    endTime: raw.end_time,
  };
}

export async function getAdSet(connectionKey: string, adSetId: string): Promise<MetaAdSet> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<RawAdSet>(`/${adSetId}`, {
    accessToken,
    operationName: 'getAdSet',
    params: { fields: AD_SET_FIELDS },
  });
  return mapAdSet(result.data);
}

export async function listAdSets(connectionKey: string, campaignId: string): Promise<MetaAdSet[]> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<{ data: RawAdSet[] }>(`/${campaignId}/adsets`, {
    accessToken,
    operationName: 'listAdSets',
    params: { fields: AD_SET_FIELDS, limit: 200 },
  });
  return result.data.data.map(mapAdSet);
}

export async function createAdSet(connectionKey: string, input: CreateAdSetInput): Promise<MetaAdSet> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const accountId = normalizeAccountId(input.accountId);

  const result = await metaClient.post<{ id: string }>(`/${accountId}/adsets`, {
    accessToken,
    operationName: 'createAdSet',
    body: {
      campaign_id: input.campaignId,
      name: input.name,
      billing_event: input.billingEvent,
      optimization_goal: input.optimizationGoal,
      targeting: mapTargetingToGraph(input.targeting),
      daily_budget: input.dailyBudgetCents,
      lifetime_budget: input.lifetimeBudgetCents,
      bid_amount: input.bidAmountCents,
      status: input.status ?? 'PAUSED',
      start_time: input.startTime,
      end_time: input.endTime,
    },
  });

  return getAdSet(connectionKey, result.data.id);
}

export async function updateAdSetTargeting(
  connectionKey: string,
  adSetId: string,
  targeting: MetaTargeting,
): Promise<MetaAdSet> {
  const accessToken = await getFreshAccessToken(connectionKey);
  await metaClient.post<{ success: boolean }>(`/${adSetId}`, {
    accessToken,
    operationName: 'updateAdSetTargeting',
    body: { targeting: mapTargetingToGraph(targeting) },
  });
  return getAdSet(connectionKey, adSetId);
}
