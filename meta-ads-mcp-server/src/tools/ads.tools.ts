import { z } from 'zod';
import { createTool } from './createTool.js';
import { connectionKeySchema, campaignStatusSchema, creativeSchema, carouselCardSchema } from './schemas.js';
import { resolveConnectionKey } from './connection.util.js';
import { runBulk } from './bulk.util.js';
import { metaProvider } from '../providers/meta/meta.provider.js';
import { BULK_OPERATION_LIMITS } from '../config/constants.js';

const listAdsSchema = z.object({
  connectionKey: connectionKeySchema,
  adSetId: z.string(),
});

export const listAdsTool = createTool({
  name: 'list_ads',
  description: 'Lists ads within a Meta ad set.',
  inputSchema: listAdsSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.listAds(connectionKey, input.adSetId);
  },
});

const createAdSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
  adSetId: z.string(),
  name: z.string().min(1),
  creative: creativeSchema,
  status: campaignStatusSchema.optional().describe('Defaults to PAUSED so nothing spends until you explicitly resume it.'),
});

export const createAdTool = createTool({
  name: 'create_ad',
  description:
    'Creates a Meta ad (creative + ad) within an ad set. Supports Single Image, Carousel, Video, Collection, Reels, and Stories creative types via creative.type. Defaults to PAUSED status for safety.',
  inputSchema: createAdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.createAd(connectionKey, {
      accountId: input.accountId,
      adSetId: input.adSetId,
      name: input.name,
      creative: input.creative,
      status: input.status,
    });
  },
});

const createCarouselAdSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
  adSetId: z.string(),
  name: z.string().min(1),
  pageId: z.string(),
  message: z.string(),
  link: z.string().url(),
  headline: z.string().optional(),
  description: z.string().optional(),
  callToActionType: z.string().optional(),
  cards: z.array(carouselCardSchema).min(2).describe('At least 2 carousel cards.'),
  status: campaignStatusSchema.optional(),
});

export const createCarouselAdTool = createTool({
  name: 'create_carousel_ad',
  description: 'Convenience tool for creating a Carousel ad (creative + ad) without assembling the creative payload by hand.',
  inputSchema: createCarouselAdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.createAd(connectionKey, {
      accountId: input.accountId,
      adSetId: input.adSetId,
      name: input.name,
      status: input.status,
      creative: {
        accountId: input.accountId,
        name: `${input.name} - creative`,
        type: 'CAROUSEL',
        pageId: input.pageId,
        message: input.message,
        link: input.link,
        headline: input.headline,
        description: input.description,
        callToActionType: input.callToActionType,
        carouselCards: input.cards,
      },
    });
  },
});

const bulkCreateAdsSchema = z.object({
  connectionKey: connectionKeySchema,
  ads: z
    .array(
      z.object({
        accountId: z.string(),
        adSetId: z.string(),
        name: z.string().min(1),
        creative: creativeSchema,
        status: campaignStatusSchema.optional(),
      }),
    )
    .min(1)
    .max(BULK_OPERATION_LIMITS.maxBatchSize),
});

export const bulkCreateAdsTool = createTool({
  name: 'bulk_create_ads',
  description: `Creates up to ${BULK_OPERATION_LIMITS.maxBatchSize} ads in one call. Returns a per-ad success/failure result.`,
  inputSchema: bulkCreateAdsSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return runBulk(input.ads, (ad) => metaProvider.createAd(connectionKey, ad));
  },
});

export const adsTools = [listAdsTool, createAdTool, createCarouselAdTool, bulkCreateAdsTool];
