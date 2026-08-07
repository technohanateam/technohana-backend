import { LINKEDIN_CACHE_NAMESPACES, LINKEDIN_CACHE_TTL_SECONDS } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/linkedinTokenManager.js';
import { linkedinClient } from './client.js';
import { creativeUrn, idFromUrn } from './urn.util.js';
import type {
  CreateCarouselAdInput,
  CreateSingleImageAdInput,
  CreateVideoAdInput,
  LinkedInCarouselCardInput,
  LinkedInCreative,
  LinkedInCreativeStatus,
  LinkedInCreativeType,
  UpdateCreativeInput,
} from '../../types/linkedin.types.js';

interface RawCreativeContent {
  media?: { title?: string; id: string };
  carousel?: { cards: Array<{ landingPage: string; headline: string; media: { id: string } }> };
}

interface RawCreative {
  id: number;
  account: string;
  campaign: string;
  type: LinkedInCreativeType;
  status: LinkedInCreativeStatus;
  commentary?: string;
  content?: RawCreativeContent;
  landingPage?: string;
  callToAction?: { label: string };
  createdAt: number;
  lastModifiedAt: number;
}

interface RawCreativesResponse {
  elements: RawCreative[];
}

function mapCreative(raw: RawCreative): LinkedInCreative {
  const cards: LinkedInCarouselCardInput[] | undefined = raw.content?.carousel?.cards.map((card) => ({
    imageAssetUrn: card.media.id,
    headline: card.headline,
    landingPageUrl: card.landingPage,
  }));

  return {
    urn: creativeUrn(String(raw.id)),
    id: String(raw.id),
    accountUrn: raw.account,
    campaignUrn: raw.campaign,
    type: raw.type,
    status: raw.status,
    headline: raw.content?.media?.title,
    commentary: raw.commentary,
    landingPageUrl: raw.landingPage,
    imageAssetUrn: raw.type === 'SINGLE_IMAGE' ? raw.content?.media?.id : undefined,
    videoAssetUrn: raw.type === 'VIDEO' ? raw.content?.media?.id : undefined,
    carouselCards: cards,
    callToActionLabel: raw.callToAction?.label,
    createdAt: new Date(raw.createdAt).toISOString(),
    lastModifiedAt: new Date(raw.lastModifiedAt).toISOString(),
  };
}

async function invalidateCreativeListCache(campaignUrn: string): Promise<void> {
  await getCacheAdapter().invalidate(LINKEDIN_CACHE_NAMESPACES.CREATIVES, `creative-list:${campaignUrn}`);
}

export async function getCreative(connectionKey: string, urn: string): Promise<LinkedInCreative> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawCreative>(`/adCreatives/${idFromUrn(urn)}`, {
    accessToken,
    operationName: 'getCreative',
  });
  return mapCreative(result.data);
}

export async function listCreatives(connectionKey: string, campaignUrn: string): Promise<LinkedInCreative[]> {
  const cache = getCacheAdapter();
  const cacheKey = `creative-list:${campaignUrn}`;
  const cached = await cache.get<LinkedInCreative[]>(LINKEDIN_CACHE_NAMESPACES.CREATIVES, cacheKey);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawCreativesResponse>('/adCreatives', {
    accessToken,
    operationName: 'listCreatives',
    params: { q: 'search', 'search.campaign.values[0]': campaignUrn },
  });

  const creatives = result.data.elements.map(mapCreative);
  await cache.set(LINKEDIN_CACHE_NAMESPACES.CREATIVES, cacheKey, creatives, LINKEDIN_CACHE_TTL_SECONDS[LINKEDIN_CACHE_NAMESPACES.CREATIVES]);
  return creatives;
}

async function createCreative(
  connectionKey: string,
  campaignUrn: string,
  body: Record<string, unknown>,
): Promise<LinkedInCreative> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.post<unknown>('/adCreatives', {
    accessToken,
    operationName: 'createCreative',
    body,
  });

  if (!result.restliId) {
    throw new Error('LinkedIn did not return an ID for the newly-created creative.');
  }

  await invalidateCreativeListCache(campaignUrn);
  return getCreative(connectionKey, creativeUrn(result.restliId));
}

export async function createSingleImageAd(connectionKey: string, input: CreateSingleImageAdInput): Promise<LinkedInCreative> {
  return createCreative(connectionKey, input.campaignUrn, {
    account: input.accountUrn,
    campaign: input.campaignUrn,
    type: 'SINGLE_IMAGE',
    status: input.status ?? 'DRAFT',
    commentary: input.commentary,
    landingPage: input.landingPageUrl,
    content: { media: { id: input.imageAssetUrn, title: input.headline } },
    callToAction: input.callToActionLabel ? { label: input.callToActionLabel } : undefined,
  });
}

export async function createVideoAd(connectionKey: string, input: CreateVideoAdInput): Promise<LinkedInCreative> {
  return createCreative(connectionKey, input.campaignUrn, {
    account: input.accountUrn,
    campaign: input.campaignUrn,
    type: 'VIDEO',
    status: input.status ?? 'DRAFT',
    commentary: input.commentary,
    landingPage: input.landingPageUrl,
    content: { media: { id: input.videoAssetUrn, title: input.headline } },
    callToAction: input.callToActionLabel ? { label: input.callToActionLabel } : undefined,
  });
}

export async function createCarouselAd(connectionKey: string, input: CreateCarouselAdInput): Promise<LinkedInCreative> {
  return createCreative(connectionKey, input.campaignUrn, {
    account: input.accountUrn,
    campaign: input.campaignUrn,
    type: 'CAROUSEL',
    status: input.status ?? 'DRAFT',
    commentary: input.commentary,
    content: {
      carousel: {
        cards: input.cards.map((card) => ({
          landingPage: card.landingPageUrl,
          headline: card.headline,
          media: { id: card.imageAssetUrn },
        })),
      },
    },
  });
}

export async function updateCreative(connectionKey: string, urn: string, input: UpdateCreativeInput): Promise<LinkedInCreative> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const existing = await getCreative(connectionKey, urn);

  const set: Record<string, unknown> = {};
  // Rest.li partial-update patches represent nested fields as nested objects,
  // not dot-path strings, so a headline edit re-sends the whole `content`
  // object (built from the freshly-fetched `existing` creative) rather than
  // a single `content.media.title` key.
  if (input.headline !== undefined) {
    set.content = { media: { id: existing.imageAssetUrn ?? existing.videoAssetUrn, title: input.headline } };
  }
  if (input.commentary !== undefined) set.commentary = input.commentary;
  if (input.landingPageUrl !== undefined) set.landingPage = input.landingPageUrl;
  if (input.callToActionLabel !== undefined) set.callToAction = { label: input.callToActionLabel };
  if (input.status !== undefined) set.status = input.status;

  await linkedinClient.patch(`/adCreatives/${idFromUrn(urn)}`, {
    accessToken,
    operationName: 'updateCreative',
    patch: { patch: { $set: set } },
  });

  await invalidateCreativeListCache(existing.campaignUrn);
  return getCreative(connectionKey, urn);
}
