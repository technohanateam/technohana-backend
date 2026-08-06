import { z } from 'zod';
import { META_CAMPAIGN_OBJECTIVES } from '../config/constants.js';

export const connectionKeySchema = z
  .string()
  .optional()
  .describe(
    "Which stored Meta connection to use (a Business Manager ID from list_businesses, or 'personal' if you have no Business Manager). Omit only if exactly one Meta account is connected - it will be used automatically.",
  );

export const campaignObjectiveSchema = z
  .enum(META_CAMPAIGN_OBJECTIVES)
  .describe('The Meta ODAX campaign objective.');

export const bidStrategySchema = z.enum([
  'LOWEST_COST_WITHOUT_CAP',
  'LOWEST_COST_WITH_BID_CAP',
  'COST_CAP',
  'LOWEST_COST_WITH_MIN_ROAS',
]);

export const campaignStatusSchema = z.enum(['ACTIVE', 'PAUSED']);

export const datePresetSchema = z.enum([
  'today',
  'yesterday',
  'last_7d',
  'last_14d',
  'last_30d',
  'last_90d',
  'this_month',
  'last_month',
  'this_quarter',
  'maximum',
]);

export const geoLocationSchema = z.object({
  countries: z.array(z.string()).optional().describe('ISO country codes, e.g. ["US", "CA"].'),
  regions: z.array(z.object({ key: z.string() })).optional(),
  cities: z
    .array(
      z.object({
        key: z.string(),
        radius: z.number().positive().optional(),
        distanceUnit: z.enum(['mile', 'kilometer']).optional(),
      }),
    )
    .optional(),
});

export const targetingSchema = z.object({
  geoLocations: geoLocationSchema.optional(),
  ageMin: z.number().int().min(13).max(65).optional(),
  ageMax: z.number().int().min(13).max(65).optional(),
  genders: z.array(z.union([z.literal(1), z.literal(2)])).optional().describe('1 = male, 2 = female. Omit for all genders.'),
  interests: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
  behaviors: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
  customAudiences: z.array(z.object({ id: z.string() })).optional(),
  excludedCustomAudiences: z.array(z.object({ id: z.string() })).optional(),
  languages: z
    .array(z.object({ key: z.string() }))
    .optional()
    .describe('Meta numeric locale IDs as strings (e.g. "6" for US English), not ISO language codes.'),
  publisherPlatforms: z.array(z.enum(['facebook', 'instagram', 'audience_network', 'messenger'])).optional(),
});

export const carouselCardSchema = z.object({
  imageHash: z.string().optional().describe('Image hash from upload_image.'),
  videoId: z.string().optional().describe('Video ID from upload_video.'),
  link: z.string().url(),
  name: z.string(),
  description: z.string().optional(),
});

export const creativeTypeSchema = z.enum(['SINGLE_IMAGE', 'CAROUSEL', 'VIDEO', 'COLLECTION', 'REELS', 'STORIES']);

export const creativeSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  type: creativeTypeSchema,
  pageId: z.string().describe('The Facebook Page ID the ad will be published from.'),
  message: z.string().describe('The main ad body text.'),
  headline: z.string().optional(),
  description: z.string().optional(),
  link: z.string().url(),
  callToActionType: z.string().optional().describe('e.g. LEARN_MORE, SHOP_NOW, SIGN_UP.'),
  imageHash: z.string().optional().describe('Required for SINGLE_IMAGE/STORIES creatives - from upload_image.'),
  videoId: z.string().optional().describe('Required for VIDEO/REELS creatives - from upload_video.'),
  thumbnailUrl: z.string().url().optional(),
  carouselCards: z.array(carouselCardSchema).optional().describe('Required for CAROUSEL/COLLECTION creatives.'),
});
